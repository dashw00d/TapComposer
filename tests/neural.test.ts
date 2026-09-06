import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as ort from 'onnxruntime-web/wasm';
import { neuralHum, resampleVoice } from '../lib/music/neural';
import { analyzeHum } from '../lib/music/analyze';

ort.env.wasm.numThreads = 1;
const model = await readFile(
  new URL('../public/models/crepe-tiny-91fc2a0f.onnx', import.meta.url),
);
assert.equal(
  createHash('sha256').update(model).digest('hex'),
  '91fc2a0fd10f965dbf7775995daf50e99273caedd7efd00001f23be649da1bc3',
);
const session = await ort.InferenceSession.create(model, {
  executionProviders: ['wasm'],
});
function melody(amplitude: number, rate = 16000) {
  const notes = [57, 60, 64, 62, 60, 57],
    pcm = new Float32Array(Math.floor(notes.length * 0.65 * rate));
  for (let n = 0; n < notes.length; n++) {
    let phase = 0;
    for (let i = 0; i < rate * 0.5; i++) {
      const time = i / rate;
      const hz = 440 * 2 ** ((notes[n] + 0.1 * Math.sin(time * 31) - 69) / 12);
      phase += (2 * Math.PI * hz) / rate;
      pcm[Math.floor(n * 0.65 * rate) + i] =
        Math.sin(phase) *
        amplitude *
        Math.min(1, time * 100, (0.5 - time) * 100);
    }
  }
  return { notes, pcm };
}
void test('real CREPE weights recover six quiet hummed notes that the DSP gate misses', async () => {
  const { notes, pcm } = melody(0.009);
  const progress: number[] = [];
  const intent = await neuralHum(pcm, 16000, session, (value) =>
    progress.push(value),
  );
  assert.equal(intent.analyzer, 'crepe-tiny');
  assert.deepEqual(
    intent.events.map((e) => Math.round(e.pitch!)),
    notes,
  );
  assert.equal(analyzeHum(pcm, 16000).events.length, 0);
  assert.equal(progress.at(-1), 1);
  for (const e of intent.events)
    assert.ok(e.duration >= 0.3 && e.duration <= 0.6);
});
void test('neural recognition rejects silence, DC and deterministic broadband noise', async () => {
  let seed = 71;
  for (const kind of ['silence', 'dc', 'noise']) {
    const pcm = Float32Array.from({ length: 8000 }, () => {
      seed = (seed * 16807) % 2147483647;
      return kind === 'silence'
        ? 0
        : kind === 'dc'
          ? 0.3
          : ((seed / 2147483647) * 2 - 1) * 0.15;
    });
    const intent = await neuralHum(pcm, 16000, session);
    assert.equal(intent.events.length, 0, kind);
  }
});
void test('voice resampling preserves duration and pitch at 44.1 and 48 kHz', async () => {
  for (const rate of [44100, 48000]) {
    const { pcm } = melody(0.3, rate);
    const slice = pcm.slice(0, Math.floor(rate * 0.6));
    assert.equal(resampleVoice(slice, rate).length, 9600);
    const intent = await neuralHum(slice, rate, session);
    assert.equal(Math.round(intent.events[0].pitch!), 57);
    assert.ok(intent.events[0].time < 0.08);
  }
  assert.throws(() => resampleVoice(new Float32Array(1), NaN));
  await assert.rejects(
    neuralHum(new Float32Array(16000), 16000, session, () => {}, -1),
    /budget/,
  );
  await session.release();
});
