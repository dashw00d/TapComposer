import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humFramesToIntent, type PitchFrame } from '../lib/music/analyze';

function phrase(
  change: (frame: PitchFrame, index: number) => PitchFrame,
  hop = 0.02,
) {
  const frames = Array.from({ length: Math.round(1.6 / hop) }, (_, i) =>
    change(
      {
        time: i * hop,
        pitch: 60 + 0.18 * Math.sin(i * hop * 32),
        confidence: 0.95,
        rms: 0.12,
      },
      i,
    ),
  );
  return humFramesToIntent(frames, hop, 1.6);
}
void test('one held hum stays one note through short octave errors and voiced detection dropouts', () => {
  for (const hop of [0.016, 0.02]) {
    for (const problem of ['octave', 'dropout', 'wobble']) {
      const intent = phrase(
        (f) =>
          f.time >= 0.6 && f.time < (problem === 'dropout' ? 0.72 : 0.66)
            ? {
                ...f,
                pitch:
                  problem === 'dropout'
                    ? NaN
                    : problem === 'octave'
                      ? 72
                      : 61.4,
                confidence: problem === 'dropout' ? 0.3 : 0.85,
              }
            : f,
        hop,
      );
      assert.equal(intent.events.length, 1, `${problem} at ${hop} second hop`);
      assert.equal(Math.round(intent.events[0].pitch!), 60);
      assert.ok(intent.events[0].duration > 1.5);
    }
  }
});
void test('real breaths separate repeated notes while genuine pitch changes keep their onset', () => {
  for (const hop of [0.016, 0.02]) {
    const breathed = phrase(
      (f) =>
        f.time >= 0.6 && f.time < 0.72
          ? { ...f, pitch: NaN, rms: 0.0005, confidence: 0 }
          : f,
      hop,
    );
    assert.equal(breathed.events.length, 2);
    assert.ok(breathed.events[1].time >= 0.7);
    for (const pitch of [61, 64, 72]) {
      const changed = phrase((f) => (f.time >= 0.6 ? { ...f, pitch } : f), hop);
      assert.deepEqual(
        changed.events.map((e) => Math.round(e.pitch!)),
        [60, pitch],
      );
      assert.ok(
        Math.abs(changed.events[1].time - 0.6) <= hop + 1e-6,
        'confirmation must not delay note onset',
      );
    }
  }
});
void test('deep vibrato and a brief tail glitch do not create extra notes', () => {
  const vibrato = phrase((f) => ({
    ...f,
    pitch: 60 + 0.65 * Math.sin(f.time * 2 * Math.PI * 5),
  }));
  assert.equal(vibrato.events.length, 1);
  const tail = phrase((f) => (f.time > 1.52 ? { ...f, pitch: 72 } : f));
  assert.equal(tail.events.length, 1);
});
void test('short intentional notes and silence stay distinct without inventing notes in a long dropout', () => {
  const short = phrase((f) => ({
    ...f,
    pitch: f.time >= 0.6 && f.time < 0.72 ? 64 : 60,
  }));
  assert.deepEqual(
    short.events.map((e) => Math.round(e.pitch!)),
    [60, 64, 60],
  );
  const gap = phrase((f) =>
    f.time >= 0.5 && f.time < 0.9 ? { ...f, pitch: NaN } : f,
  );
  assert.equal(gap.events.length, 2);
  assert.ok(gap.events[0].time + gap.events[0].duration < 0.55);
  assert.ok(gap.events[1].time >= 0.9);
});
void test('dum syllables re-attack even when the pitch tracker remains confident through a quiet valley', () => {
  const syllables = phrase((f) => ({
    ...f,
    pitch: 60,
    rms: f.time >= 0.6 && f.time < 0.68 ? 0.015 : 0.12,
  }));
  assert.equal(syllables.events.length, 2);
  assert.ok(Math.abs(syllables.events[1].time - 0.68) < 0.025);
  const tremolo = phrase((f) => ({
    ...f,
    rms: 0.1 + 0.03 * Math.sin(f.time * 24),
  }));
  assert.equal(tremolo.events.length, 1);
});
void test('an unvoiced consonant separates dum syllables even without a silent gap', () => {
  const consonants = phrase((f) =>
    f.time >= 0.6 && f.time < 0.7
      ? { ...f, pitch: NaN, confidence: 0.04, rms: 0.13 }
      : f,
  );
  assert.equal(consonants.events.length, 2);
});
void test('a casual slide between two stable notes does not turn into a staircase of extra attacks', () => {
  const slide = phrase((f) => ({
    ...f,
    pitch:
      f.time < 0.5 ? 60 : f.time < 0.74 ? 60 + ((f.time - 0.5) / 0.24) * 4 : 64,
  }));
  assert.deepEqual(
    slide.events.map((e) => Math.round(e.pitch!)),
    [60, 64],
  );
});
