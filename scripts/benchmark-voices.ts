import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as ort from 'onnxruntime-web/wasm';
import { neuralPitchFrames } from '../lib/music/neural';
import { humFramesToIntent, type PitchFrame } from '../lib/music/analyze';
import { readVoiceWav } from './voice-audio';
import { noteScore, frameScore, type Note } from './voice-metrics';

const root = 'outputs/voice-benchmark';
const label = process.argv[2] ?? `run-${Date.now()}`;
const model = process.argv[3] ?? 'tiny';
const partition = process.argv[4] ?? 'dev';
const cached = process.argv[5];
if (cached && !/^[\w-]+$/.test(cached)) throw new Error('Invalid cache label');
if (
  !/^[\w-]+$/.test(label) ||
  !['tiny', 'small'].includes(model) ||
  !['dev', 'heldout', 'all'].includes(partition)
)
  throw new Error(
    'Usage: benchmark-voices.ts LABEL [tiny|small] [dev|heldout|all]',
  );
if (cached === label)
  throw new Error('Choose a new result label to preserve cached evidence');
const analysisSha256 = createHash('sha256')
  .update(await readFile('lib/music/analyze.ts'))
  .update(await readFile('lib/music/neural.ts'))
  .digest('hex');
ort.env.wasm.numThreads = 1;
const weights = await readFile(
  model === 'tiny'
    ? 'public/models/crepe-tiny-91fc2a0f.onnx'
    : 'outputs/model-comparison/crepe-small.onnx',
);
if (cached) {
  const metadata = JSON.parse(
    await readFile(`${root}/${cached}/summary.json`, 'utf8'),
  );
  if (
    metadata.summary.modelSha256 !==
    createHash('sha256').update(weights).digest('hex')
  )
    throw new Error('Cached model mismatch');
}
const session = await ort.InferenceSession.create(weights, {
  executionProviders: ['wasm'],
});
const csv = async (path: string) =>
  (await readFile(path, 'utf8'))
    .trim()
    .split(/\r?\n/)
    .map((r) => r.split(',').map(Number));
const corpus = root;
const metadata = (await readFile(`${corpus}/vocadito_metadata.csv`, 'utf8'))
  .trim()
  .split(/\r?\n/)
  .map((r) => r.split(','));
const columns = metadata.shift()!;
const singers = new Map(
  metadata.map((r) => [
    r[columns.indexOf('track_id')],
    r[columns.indexOf('singer_id')],
  ]),
);
const results = [];
await mkdir(`${root}/${label}`); // Refuse to overwrite prior benchmark evidence.
try {
  for (const name of (await readdir(`${corpus}/Audio`))
    .filter((n) => n.endsWith('.wav'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const id = name.slice(0, -4),
      singer = singers.get(id.replace('vocadito_', ''));
    if (!singer) throw new Error(`Missing singer for ${id}`);
    const split =
      createHash('sha256')
        .update(`tapcomposer-voice-v1:${singer}`)
        .digest()[0] %
        3 ===
      0
        ? 'heldout'
        : 'dev';
    if (partition !== 'all' && split !== partition) continue;
    const { pcm, rate } = readVoiceWav(
      await readFile(`${corpus}/Audio/${name}`),
    );
    const duration = pcm.length / rate;
    const start = performance.now();
    const previous = cached
      ? JSON.parse(await readFile(`${root}/${cached}/${id}.json`, 'utf8'))
      : null;
    const frames: PitchFrame[] = previous
      ? previous.frames.map((f: PitchFrame) => ({
          ...f,
          pitch: f.pitch ?? NaN,
        }))
      : await neuralPitchFrames(pcm, rate, session, () => {}, 60000);
    const milliseconds = previous
      ? previous.result.milliseconds
      : performance.now() - start;
    const intent = humFramesToIntent(frames, 0.02, duration);
    const notes = intent.events.map((e) => ({
      time: e.time,
      duration: e.duration,
      pitch: Math.round(e.pitch!),
    }));
    const annotations: Note[][] = [];
    for (const a of [1, 2])
      annotations.push(
        (await csv(`${corpus}/Annotations/Notes/${id}_notesA${a}.csv`))
          .filter((r) => r[0] < duration && r[1] > 0)
          .map((r) => ({
            time: r[0],
            pitch: 69 + 12 * Math.log2(r[1] / 440),
            duration: Math.min(r[2], duration - r[0]),
          })),
      );
    const referenceFrames = (
      await csv(`${corpus}/Annotations/F0/${id}_f0.csv`)
    ).filter((r) => r[0] < duration);
    const result = {
      id,
      singer,
      split,
      duration,
      milliseconds,
      frame: frameScore(referenceFrames, frames),
      notes100: annotations.map((a) => noteScore(a, notes)),
      notes50: annotations.map((a) => noteScore(a, notes, 0.05)),
    };
    results.push(result);
    await writeFile(
      `${root}/${label}/${id}.json`,
      JSON.stringify({ result, frames, notes, annotations }),
    );
    console.log(
      `${id}: pitch ${(result.frame.pitchRecall * 100).toFixed(1)}%, notes ${notes.length}/${annotations[0].length}, F1 ${(result.notes100[0].f1 * 100).toFixed(1)}%`,
    );
  }
} finally {
  await session.release();
}
const mean = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const summary = {
  label,
  model,
  partition,
  cachedFrames: cached ?? null,
  analysisSha256,
  modelSha256: createHash('sha256').update(weights).digest('hex'),
  recordings: results.length,
  singers: new Set(results.map((r) => r.singer)).size,
  seconds: results.reduce((a, r) => a + r.duration, 0),
  pitchRecall: mean(results.map((r) => r.frame.pitchRecall)),
  voiceRecall: mean(results.map((r) => r.frame.voiceRecall)),
  falseVoiceRate: mean(results.map((r) => r.frame.falseVoiceRate)),
  noteF1_100: mean(results.flatMap((r) => r.notes100.map((n) => n.f1))),
  noteF1_50: mean(results.flatMap((r) => r.notes50.map((n) => n.f1))),
  predictedNotes: results.reduce((a, r) => a + r.notes100[0].predicted, 0),
  referenceNotes: results.reduce((a, r) => a + r.notes100[0].reference, 0),
  realtimeFactor:
    results.reduce((a, r) => a + r.milliseconds / 1000, 0) /
    Math.max(
      1,
      results.reduce((a, r) => a + r.duration, 0),
    ),
};
await writeFile(
  `${root}/${label}/summary.json`,
  JSON.stringify({ summary, results }, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
