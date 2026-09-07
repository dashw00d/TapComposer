import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeHum,
  analyzeTaps,
  buildIntent,
  detectPitch,
} from '../lib/music/analyze';
import { inferContext, resolveIntent, smoothTrack } from '../lib/music/resolve';
import { encodeWav } from '../lib/music/wav';
import type { Track } from '../lib/music/types';

function voice(notes: number[], rate = 48000) {
  const pcm = new Float32Array(Math.ceil((notes.length * 0.5 + 0.2) * rate));
  notes.forEach((note, index) => {
    let phase = 0;
    const frequency = 440 * 2 ** ((note - 69) / 12);
    for (let i = 0; i < rate * 0.4; i++) {
      const time = i / rate;
      phase +=
        (2 * Math.PI * frequency * 2 ** ((0.16 * Math.sin(time * 31)) / 12)) /
        rate;
      const envelope = Math.min(1, time / 0.015, (0.4 - time) / 0.02);
      pcm[Math.floor((index * 0.5 + 0.1) * rate) + i] =
        envelope *
        (Math.sin(phase) * 0.22 +
          Math.sin(phase * 2) * 0.1 +
          Math.sin(phase * 3) * 0.04);
    }
  });
  return pcm;
}
void test('YIN detects low and high hum pitches at common microphone rates', () => {
  for (const rate of [8000, 16000, 44100, 48000])
    for (const note of [40, 48, 60, 69, 76]) {
      const frame = Float32Array.from(
        { length: Math.ceil(rate * 0.08) },
        (_, i) =>
          0.3 *
          Math.sin((2 * Math.PI * (440 * 2 ** ((note - 69) / 12)) * i) / rate),
      );
      const result = detectPitch(frame, rate);
      assert.ok(result, `note ${note} rate ${rate}`);
      assert.ok(
        Math.abs(result.pitch - note) < 0.15,
        `${note}: ${result.pitch}`,
      );
    }
});
void test('six wobbly hummed notes become six recognizable notes, preserving gaps', () => {
  const expected = [60, 64, 67, 65, 62, 60],
    intent = analyzeHum(voice(expected), 48000);
  assert.equal(intent.events.length, 6);
  assert.deepEqual(
    intent.events.map((e) => Math.round(e.pitch!)),
    expected,
  );
  for (let i = 0; i < 6; i++) {
    assert.ok(Math.abs(intent.events[i].time - (0.1 + i * 0.5)) < 0.09);
    assert.ok(intent.events[i].duration > 0.25);
  }
});
void test('silence, DC offset and broadband noise do not create piano notes', () => {
  assert.equal(analyzeHum(new Float32Array(16000), 16000).events.length, 0);
  assert.equal(
    analyzeHum(new Float32Array(16000).fill(0.3), 16000).events.length,
    0,
  );
  let seed = 321;
  const noise = Float32Array.from({ length: 16000 }, () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 0.1;
  });
  assert.equal(analyzeHum(noise, 16000).events.length, 0);
});
void test('tap detector separates desk strikes and preserves accent strength', () => {
  const rate = 48000,
    pcm = new Float32Array(rate * 3);
  const times = [0.2, 0.7, 1.2, 1.7, 2.2];
  times.forEach((time, k) => {
    for (let i = 0; i < rate * 0.08; i++)
      pcm[Math.round(time * rate) + i] =
        Math.sin(i * 1.7) * Math.exp((-i / rate) * 70) * (k === 2 ? 0.7 : 0.3);
  });
  const intent = analyzeTaps(pcm, rate);
  assert.equal(intent.events.length, times.length);
  intent.events.forEach((e, i) =>
    assert.ok(Math.abs(e.time - times[i]) < 0.03),
  );
  assert.ok(intent.events[2].intensity > intent.events[0].intensity);
  assert.equal(analyzeTaps(new Float32Array(48000), 48000).events.length, 0);
});
void test('a steady tap pattern infers its pulse and instruments arrange distinct events', () => {
  const intent = buildIntent(
    'touch',
    Array.from({ length: 8 }, (_, i) => ({
      time: i * 0.5,
      duration: 0.1,
      pitch: null,
      intensity: i % 2 === 0 ? 0.9 : 0.6,
      confidence: 1,
    })),
    4,
  );
  const context = inferContext(intent);
  assert.ok(Math.abs(context.tempo - 120) <= 1);
  const drums = resolveIntent(intent, 'drums', context);
  assert.ok(drums.events.some((e) => e.note === 36));
  assert.ok(drums.events.some((e) => e.note === 38));
  assert.equal(drums.duration, 4);
});
void test('natural hum timing and initial silence remain exact until smoothing', () => {
  const intent = buildIntent(
      'hum',
      [
        {
          time: 1.793,
          duration: 0.3,
          pitch: 60.2,
          intensity: 0.6,
          confidence: 0.8,
        },
      ],
      2.2,
    ),
    context = { tempo: 120, key: 0, mode: 'major' as const, confidence: 0.7 };
  const resolved = resolveIntent(intent, 'piano', context, false, true);
  assert.equal(resolved.events[0].time, 1.793);
  const first = resolveIntent(intent, 'piano', context, false, false);
  assert.equal(first.events[0].time, 0);
});
void test('smoothing is reversible and leaves original intent and audio intact', () => {
  const intent = buildIntent(
      'hum',
      [
        {
          time: 0.12,
          duration: 0.3,
          pitch: 60.3,
          intensity: 0.8,
          confidence: 0.8,
        },
      ],
      1,
    ),
    context = inferContext(intent),
    original = new Blob(['recording']);
  const track: Track = {
    id: 't',
    name: 'Piano',
    instrument: 'piano',
    intent,
    ...resolveIntent(intent, 'piano', context, false, true),
    muted: false,
    smoother: false,
    original,
  };
  const smooth = smoothTrack(track, context),
    restored = smoothTrack(smooth, context);
  assert.deepEqual(restored.events, track.events);
  assert.equal(smooth.intent, intent);
  assert.equal(smooth.original, original);
});
void test('WAV is valid interleaved 16-bit stereo with bounded signed samples', async () => {
  const wav = encodeWav(
    [new Float32Array([-2, 0, 2]), new Float32Array([0.5, -0.5, 0])],
    44100,
  );
  const buffer = await wav.arrayBuffer(),
    data = new DataView(buffer);
  assert.equal(buffer.byteLength, 56);
  assert.equal(data.getUint16(22, true), 2);
  assert.equal(data.getUint32(24, true), 44100);
  assert.equal(data.getInt16(44, true), -32768);
  assert.equal(data.getInt16(52, true), 32767);
  assert.equal(data.getUint32(40, true), 12);
});
void test('repeated hummed pitches remain separate notes across short breaths', () => {
  const intent = analyzeHum(voice([60, 60, 60, 64, 64, 60]), 48000);
  assert.equal(intent.events.length, 6);
  assert.deepEqual(
    intent.events.map((e) => Math.round(e.pitch!)),
    [60, 60, 60, 64, 64, 60],
  );
});
