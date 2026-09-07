import { readFile, readdir, writeFile } from 'node:fs/promises';
import { noteScore, type Note } from './voice-metrics';
const label = process.argv[2];
if (!label || !/^[\w-]+$/.test(label))
  throw new Error('Provide a benchmark label');
const root = `outputs/voice-benchmark/${label}`;
const results: {
  id: string;
  kind: string;
  mode: string;
  notes100: ReturnType<typeof noteScore>[];
  notes50: ReturnType<typeof noteScore>[];
}[] = [];
for (const file of (await readdir(root)).filter((n) =>
  n.startsWith('vocadito_'),
)) {
  const d = JSON.parse(await readFile(`${root}/${file}`, 'utf8'));
  results.push({
    ...d,
    notes100: d.annotations.map((a: Note[]) => noteScore(a, d.notes)),
    notes50: d.annotations.map((a: Note[]) => noteScore(a, d.notes, 0.05)),
  });
}
const mean = (a: number[]) => a.reduce((s, n) => s + n, 0) / a.length;
const summary = Object.fromEntries(
  ['clean', 'quiet', 'dc', 'noise-12db'].map((kind) => [
    kind,
    Object.fromEntries(
      ['raw', 'conditioned'].map((mode) => {
        const subset = results.filter(
          (r) => r.kind === kind && r.mode === mode,
        );
        return [
          mode,
          {
            clips: subset.length,
            noteF1_100: mean(
              subset.flatMap((r) =>
                r.notes100.map((s: { f1: number }) => s.f1),
              ),
            ),
            noteF1_50: mean(
              subset.flatMap((r) => r.notes50.map((s: { f1: number }) => s.f1)),
            ),
          },
        ];
      }),
    ),
  ]),
);
await writeFile(
  `${root}/summary.json`,
  JSON.stringify({ summary, results }, null, 2),
);
console.log(summary);
