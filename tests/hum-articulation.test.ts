import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humFramesToIntent, type PitchFrame } from '../lib/music/analyze';
import { annotateHumDrift } from '../lib/music/hum-articulation';
import { stabilizeHum, cleanHumIntent } from '../lib/music/phrase-cleanup';
import type { IntentEvent, MusicalIntent } from '../lib/music/types';

void test('repeated humming attacks survive without silence; a pitch dip or volume change alone does not split', () => {
  for (const hop of [0.01, 0.016, 0.02]) {
    for (const cue of ['both', 'pitch', 'level']) {
      const frames: PitchFrame[] = Array.from(
        { length: Math.round(1.6 / hop) },
        (_, i) => {
          const time = i * hop;
          const dip = Math.exp(-(((time - 0.65) / 0.04) ** 2));
          return {
            time,
            pitch: 60 - (cue !== 'level' ? dip : 0),
            rms: 0.12 * (1 + (cue !== 'pitch' ? 0.35 * dip : 0)),
            confidence: 0.95 - 0.2 * dip,
          };
        },
      );
      const before = structuredClone(frames);
      const result = humFramesToIntent(frames, hop, 1.6);
      assert.equal(
        result.events.length,
        cue === 'both' ? 2 : 1,
        `${cue} at ${hop}`,
      );
      if (cue === 'both') {
        assert.ok(Math.abs(result.events[1].time - 0.62) < 0.04);
        assert.ok(result.events.every((e) => Math.abs(e.pitch! - 60) < 0.1));
      }
      assert.deepEqual(frames, before);
    }
  }
});

void test('contour drift is a reversible cleanup suggestion; an abrupt semitone stays a real note', () => {
  const note = (
    time: number,
    duration: number,
    pitch: number,
  ): IntentEvent => ({
    time,
    duration,
    pitch,
    confidence: 0.9,
    intensity: 0.6,
  });
  for (const ramp of [true, false]) {
    const frames = Array.from({ length: 100 }, (_, i) => ({
      time: i * 0.02,
      pitch: i < 12 ? (ramp ? 59 + i / 12 : 59) : 60,
      confidence: 0.9,
      rms: 0.12,
    }));
    const raw: MusicalIntent = {
      version: 1,
      source: 'hum',
      duration: 2,
      confidence: 0.9,
      events: annotateHumDrift(
        [note(0, 0.24, 59.4), note(0.24, 1.76, 60)],
        frames,
        0.02,
      ),
    };
    const original = structuredClone(raw);
    assert.equal(stabilizeHum(raw).events.length, ramp ? 1 : 2);
    assert.equal(raw.events.length, 2);
    assert.deepEqual(raw, original);
  }
});

void test('late starts and uneven quarter notes do not invent triplets or subdivisions', () => {
  const context = { tempo: 90, key: 0, mode: 'major' as const, confidence: 1 };
  for (const [times, expected] of [
    [
      [1.22, 1.98, 2.7, 3.4, 4.04],
      [0, 1, 2, 3, 4],
    ],
    [
      [1.18, 2.98, 3.86, 4.38, 4.94],
      [0, 3, 4, 5, 6],
    ],
  ]) {
    const events = times.map((time, i) => ({
      time,
      duration: i < times.length - 1 ? times[i + 1] - time : 0.9,
      pitch: 60,
      confidence: 0.9,
      intensity: 0.7,
    }));
    const result = cleanHumIntent(
      { version: 1, source: 'hum', events, duration: 7, confidence: 0.9 },
      context,
    );
    result.events.forEach((e, i) =>
      assert.ok(Math.abs(e.time - times[0] - (expected[i] * 2) / 3) < 1e-8),
    );
  }
});
