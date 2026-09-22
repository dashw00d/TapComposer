import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteScore, frameScore, rhythmScore } from '../scripts/voice-metrics';
void test('rhythm metrics separate pitch mistakes, start delay, and missing repetitions', () => {
  const reference = [0, 0.5, 1].map((time) => ({
    time: time + 1,
    duration: 0.4,
    pitch: 60,
  }));
  const delayed = reference.map((n) => ({
    ...n,
    time: n.time + 0.25,
    pitch: 57,
  }));
  assert.equal(noteScore(reference, delayed).f1, 0);
  assert.equal(rhythmScore(reference, delayed).f1, 0);
  assert.equal(rhythmScore(reference, delayed, true).f1, 1);
  assert.ok(rhythmScore(reference, delayed.slice(0, 2), true).f1 < 1);
});
void test('voice benchmark penalizes duplicates and does not align away timing or octave errors', () => {
  const reference = [{ time: 0.2, pitch: 60, duration: 0.5 }];
  assert.equal(
    noteScore(reference, [...reference, ...reference]).precision,
    0.5,
  );
  assert.equal(
    noteScore(reference, [{ time: 0.4, pitch: 60, duration: 0.5 }]).hits,
    0,
  );
  assert.equal(
    noteScore(reference, [{ time: 0.2, pitch: 72, duration: 0.5 }]).hits,
    0,
  );
});
void test('voice benchmark uses maximum matching, independently for each human annotation', () => {
  const notes = (times: number[]) =>
    times.map((time) => ({ time, pitch: 60, duration: 0.1 }));
  assert.equal(noteScore(notes([0.1, 0.2]), notes([0.15, 0.05]), 0.06).hits, 2);
});
void test('frame benchmark counts missing voiced frames and false notes in silence', () => {
  const result = frameScore(
    [
      [0, 440],
      [0.02, 440],
      [0.04, 0],
    ],
    [
      { time: 0, pitch: 69 },
      { time: 0.02, pitch: NaN },
      { time: 0.04, pitch: 69 },
    ],
  );
  assert.equal(result.pitchRecall, 0.5);
  assert.equal(result.falseVoiceRate, 1);
});

import { readVoiceWav } from '../scripts/voice-audio';
void test('real-voice WAV loading preserves the leading silence, signed levels and 30-second clock', () => {
  function wav(rate: number, seconds: number) {
    const bytes = Buffer.alloc(44 + rate * seconds * 2);
    bytes.write('RIFF');
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(rate, 24);
    bytes.writeUInt32LE(rate * 2, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(bytes.length - 44, 40);
    bytes.writeInt16LE(-16384, 44 + (rate * 2) / 2);
    return bytes;
  }
  for (const rate of [16000, 44100]) {
    const { pcm, rate: decodedRate } = readVoiceWav(wav(rate, 1));
    assert.equal(decodedRate, rate);
    assert.equal(pcm.length, rate);
    assert.equal(pcm[0], 0);
    assert.equal(pcm[rate / 2], -0.5);
  }
  assert.equal(readVoiceWav(wav(8000, 31)).pcm.length, 8000 * 30);
  assert.throws(
    () => readVoiceWav(wav(16000, 1).subarray(0, 100)),
    /Truncated/,
  );
});
