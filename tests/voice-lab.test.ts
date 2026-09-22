import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {
  MELODIES,
  melodyScore,
  referenceTrack,
  trialKey,
  audioQuality,
  type LabSession,
  type LabTake,
} from '../lib/voice-lab/protocol';
import { mixNoise, syntheticNoise } from '../lib/voice-lab/noise';
import { exportLab, latestLab, saveLab } from '../lib/voice-lab/storage';
import { encodeWav } from '../lib/music/wav';
import { readVoiceWav } from '../scripts/voice-audio';
import { noteScore } from '../scripts/voice-metrics';

void test('all fifteen exercises share exact reference timing, include room silence, and fit the capture limit', () => {
  assert.equal(MELODIES.length, 15);
  assert.equal(new Set(MELODIES.map((m) => m.id)).size, 15);
  for (const melody of MELODIES)
    for (const root of [43, 65])
      for (const bpm of [60, 120]) {
        const score = melodyScore(melody, root, bpm);
        assert.equal(score.notes[0].time, 1);
        assert.ok(score.duration < 30);
        assert.ok(
          score.notes.at(-1)!.time + score.notes.at(-1)!.duration <
            score.duration - 1,
        );
        const track = referenceTrack(score.notes, score.duration);
        assert.deepEqual(
          track.events.map((event) => ({
            time: event.time,
            duration: event.duration,
            pitch: event.note,
          })),
          score.notes,
        );
        for (let i = 1; i < score.notes.length; i++)
          assert.ok(
            score.notes[i].time >
              score.notes[i - 1].time + score.notes[i - 1].duration,
          );
      }
});
void test('noise variants are repeatable, preserve the source, achieve their stated SNR, and prevent clipping', () => {
  const clean = Float32Array.from(
    { length: 16000 },
    (_, i) => 0.8 * Math.sin((2 * Math.PI * 220 * i) / 16000),
  );
  const snapshot = clean.slice();
  const noise = syntheticNoise(clean.length, 16000, 'rumble', 421);
  assert.deepEqual(noise, syntheticNoise(clean.length, 16000, 'rumble', 421));
  assert.notDeepEqual(
    noise,
    syntheticNoise(clean.length, 16000, 'rumble', 422),
  );
  for (const snr of [20, 10, 0]) {
    const mixed = mixNoise(clean, noise, snr, 35);
    let signalPower = 0,
      noisePower = 0;
    for (let i = 0; i < clean.length; i++) {
      signalPower += (clean[i] * mixed.gain) ** 2;
      noisePower += (mixed.pcm[i] - clean[i] * mixed.gain) ** 2;
      assert.ok(Math.abs(mixed.pcm[i]) <= 0.980001);
    }
    assert.ok(
      Math.abs(10 * Math.log10(signalPower / noisePower) - snr) < 0.001,
    );
  }
  assert.deepEqual(clean, snapshot);
  assert.throws(() => mixNoise(new Float32Array(10), noise, 10), /silent/);
});
void test('offset scoring catches chopped held notes and pitch shifts are never silently corrected', () => {
  const actual = [{ time: 1, pitch: 48, duration: 2 }];
  const shortened = [{ time: 1, pitch: 48, duration: 0.3 }];
  assert.equal(noteScore(actual, shortened, 0.05).hits, 1);
  assert.equal(noteScore(actual, shortened, 0.05, 0.2).hits, 0);
  assert.equal(
    noteScore(actual, [{ ...actual[0], pitch: 60 }], 0.05, 0.2).hits,
    0,
  );
});
void test('kept revisions, original PCM, recording setup and reserved split survive local saves and exports', async () => {
  Object.defineProperty(globalThis, 'indexedDB', {
    value: new IDBFactory(),
    configurable: true,
  });
  const pcm = Float32Array.from(
    { length: 1600 },
    (_, i) => 0.15 * Math.sin(i * 0.1),
  );
  const score = melodyScore(MELODIES[0], 48, 90);
  const take: LabTake = {
    id: 'a',
    trialKey: trialKey(
      'held',
      'hmm',
      15,
      48,
      90,
      'heldout',
      true,
      'headphones',
    ),
    createdAt: 1,
    setup: { singer: 'Ryan', microphone: 'Desk', room: 'Office' },
    melodyId: 'held',
    style: 'hmm',
    distanceCm: 15,
    root: 48,
    bpm: 90,
    split: 'heldout',
    guideDuringRecording: true,
    listening: 'headphones',
    referenceKind: 'prompt-score',
    reference: score.notes,
    duration: 0.1,
    sampleRate: 16000,
    audio: encodeWav([pcm], 16000),
    ...audioQuality(pcm),
    note: 'Missed ending',
  };
  const session: LabSession = {
    version: 1,
    id: 'session',
    createdAt: 1,
    singer: 'Ryan',
    microphone: 'Desk',
    room: 'Office',
    takes: [take, { ...take, id: 'b', note: 'Second attempt' }],
  };
  await saveLab(session);
  const restored = (await latestLab())!;
  assert.equal(restored.takes.length, 2);
  const exported = JSON.parse(await (await exportLab(restored)).text());
  assert.equal(exported.format, 'tapcomposer-voice-lab');
  assert.equal(exported.takes[1].split, 'heldout');
  assert.equal(exported.takes[1].trialKey, exported.takes[0].trialKey);
  assert.equal(exported.takes[1].setup.microphone, 'Desk');
  const decoded = readVoiceWav(
    Buffer.from(exported.takes[0].audioBase64, 'base64'),
  );
  assert.equal(decoded.rate, 16000);
  assert.equal(decoded.pcm.length, pcm.length);
  decoded.pcm.forEach((sample, i) =>
    assert.ok(Math.abs(sample - pcm[i]) < 1 / 32768),
  );
});

void test('separate singers and microphones do not count as revisions of the same trial', () => {
  const a = { singer: 'Ryan', microphone: 'Desk', room: 'Office' };
  const key = (setup: typeof a) =>
    trialKey('held', 'hmm', 15, 48, 90, 'dev', true, 'headphones', setup);
  assert.notEqual(key(a), key({ ...a, singer: 'Dad' }));
  assert.notEqual(key(a), key({ ...a, microphone: 'Laptop' }));
  assert.equal(key(a), key({ ...a }));
});
