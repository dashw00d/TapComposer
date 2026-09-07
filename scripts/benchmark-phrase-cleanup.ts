/** Compare the prior smoothing behavior and the shipped cleanup against human notes. */
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { noteScore, type Note } from './voice-metrics';
import { resolveIntent, inferContext } from '../lib/music/resolve';
import type { MusicalIntent, SongContext } from '../lib/music/types';
const source = process.argv[2] ?? 'gpu-deterministic',
  label = process.argv[3] ?? 'cleanup-v2';
if (![source, label].every((s) => /^[\w-]+$/.test(s)))
  throw new Error('Use SOURCE_LABEL OUTPUT_LABEL');
const root = 'outputs/voice-benchmark';
await mkdir(`${root}/${label}`);
// Exact piano pitch/onset rules at 7e182fb, before this cleanup revision.
function previousSmoothing(
  intent: MusicalIntent,
  context: SongContext,
): Note[] {
  const grid = 30 / context.tempo,
    scale =
      context.mode === 'major'
        ? [0, 2, 4, 5, 7, 9, 11]
        : [0, 2, 3, 5, 7, 8, 10];
  return intent.events.map((e) => {
    let pitch = Math.round(e.pitch!);
    if (e.confidence < 0.95) {
      const candidates = [pitch - 1, pitch, pitch + 1].filter((n) =>
        scale.includes((((n - context.key) % 12) + 12) % 12),
      );
      if (candidates.length)
        pitch = candidates.sort(
          (a, b) => Math.abs(a - e.pitch!) - Math.abs(b - e.pitch!),
        )[0];
    }
    return {
      time: Math.max(
        0,
        e.time + (Math.round(e.time / grid) * grid - e.time) * 0.8,
      ),
      duration: e.duration,
      pitch: Math.max(36, Math.min(84, pitch)),
    };
  });
}
const modes = ['original', 'previous', 'cleanup'] as const;
type Scores = {
  notes100: ReturnType<typeof noteScore>[];
  notes50: ReturnType<typeof noteScore>[];
  notes: Note[];
};
const results: ({ id: string; split: string } & Record<
  (typeof modes)[number],
  Scores
>)[] = [];
for (const name of (await readdir(`${root}/${source}`)).filter((n) =>
  n.startsWith('vocadito_'),
)) {
  const d = JSON.parse(await readFile(`${root}/${source}/${name}`, 'utf8')) as {
    intent: MusicalIntent;
    annotations: Note[][];
    result: { id: string; split: string };
  };
  const context = inferContext(d.intent);
  const resolve = (smooth: boolean) =>
    resolveIntent(d.intent, 'piano', context, smooth, true).events.map((e) => ({
      time: e.time,
      duration: e.duration,
      pitch: e.note,
    }));
  const score = (notes: Note[]): Scores => ({
    notes100: d.annotations.map((r) => noteScore(r, notes)),
    notes50: d.annotations.map((r) => noteScore(r, notes, 0.05)),
    notes,
  });
  results.push({
    ...d.result,
    original: score(resolve(false)),
    previous: score(previousSmoothing(d.intent, context)),
    cleanup: score(resolve(true)),
  });
}
const mean = (a: number[]) => a.reduce((s, n) => s + n, 0) / a.length;
const summary = Object.fromEntries(
  modes.map((mode) => [
    mode,
    {
      noteF1_100: mean(
        results.flatMap((r) => r[mode].notes100.map((s) => s.f1)),
      ),
      noteF1_50: mean(results.flatMap((r) => r[mode].notes50.map((s) => s.f1))),
    },
  ]),
);
const fingerprints = Object.fromEntries(
  await Promise.all(
    ['lib/music/phrase-cleanup.ts', 'lib/music/resolve.ts'].map(
      async (path) => [
        path,
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      ],
    ),
  ),
);
await writeFile(
  `${root}/${label}/summary.json`,
  JSON.stringify(
    { source, recordings: results.length, fingerprints, summary, results },
    null,
    2,
  ),
);
console.log(summary);
