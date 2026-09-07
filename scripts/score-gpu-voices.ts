import { readFile, readdir, writeFile } from 'node:fs/promises';
import { noteScore, frameScore, type Note } from './voice-metrics';
const label = process.argv[2];
if (!label || !/^[\w-]+$/.test(label))
  throw new Error('Provide a result label');
const root = `outputs/voice-benchmark/${label}`;
const results = [];
for (const file of (await readdir(root)).filter((n) =>
  n.startsWith('vocadito_'),
)) {
  const data = JSON.parse(await readFile(`${root}/${file}`, 'utf8'));
  data.notes = data.intent.events.map((e: Note) => ({
    ...e,
    pitch: Math.round(e.pitch),
  }));
  const trace = data.intent.diagnostics;
  const frames = trace.f0.map((f: number, i: number) => ({
    time: i * trace.hop,
    pitch: f > 0 ? 69 + 12 * Math.log2(f / 440) : NaN,
  }));
  const reference = (
    await readFile(
      `outputs/voice-benchmark/Annotations/F0/${data.result.id}_f0.csv`,
      'utf8',
    )
  )
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split(',').map(Number))
    .filter((r) => r[0] < data.result.duration);
  const frame = frameScore(reference, frames);
  const notes100 = data.annotations.map((a: Note[]) =>
    noteScore(a, data.notes),
  );
  const notes50 = data.annotations.map((a: Note[]) =>
    noteScore(a, data.notes, 0.05),
  );
  const result = {
    ...data.result,
    frame,
    notes100,
    notes50,
    milliseconds: data.seconds * 1000,
    gpuPeakMiB: data.gpuPeakMiB,
  };
  results.push(result);
  await writeFile(`${root}/${file}`, JSON.stringify({ ...data, result }));
  console.log(
    result.id,
    notes100.map((n: { f1: number }) => (n.f1 * 100).toFixed(1)).join('/'),
  );
}
const mean = (a: number[]) => a.reduce((s, n) => s + n, 0) / a.length;
const summary = {
  label,
  recordings: results.length,
  noteF1_100: mean(
    results.flatMap((r) => r.notes100.map((s: { f1: number }) => s.f1)),
  ),
  noteF1_50: mean(
    results.flatMap((r) => r.notes50.map((s: { f1: number }) => s.f1)),
  ),
  meanSeconds: mean(results.map((r) => r.milliseconds / 1000)),
  peakMiB: Math.max(...results.map((r) => r.gpuPeakMiB)),
};
await writeFile(
  `${root}/summary.json`,
  JSON.stringify({ summary, results }, null, 2),
);
console.log(summary);
