import type { MusicalIntent, SongContext } from './types';
export function chordAt(
  beat: number,
  context: SongContext,
  variation = 0,
): number[] {
  if (context.chords?.length)
    return context.chords[Math.floor(beat / 4) % context.chords.length];
  const scale =
    context.mode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const progressions = [
    [0, 5, 3, 4],
    [0, 3, 5, 4],
    [0, 4, 5, 3],
  ];
  const degree =
    progressions[variation % progressions.length][Math.floor(beat / 4) % 4];
  return [0, 2, 4].map((n) => {
    const step = degree + n;
    return 48 + context.key + scale[step % 7] + 12 * Math.floor(step / 7);
  });
}

/** Choose a diatonic triad for each phrase window using the melody's duration-weighted pitch classes. */
export function inferHarmony(
  intent: MusicalIntent,
  context: SongContext,
): number[][] {
  const scale =
    context.mode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const beat = 60 / context.tempo;
  const duration = Math.max(
    4,
    ...intent.events.map((e) => (e.time + e.duration) / beat),
  );
  const candidates = [0, 1, 2, 3, 4, 5].map((degree) =>
    [0, 2, 4].map((offset) => {
      const n = degree + offset;
      return 48 + context.key + scale[n % 7] + 12 * Math.floor(n / 7);
    }),
  );
  const preferred = [0, 5, 3, 4];
  let previous = 0;
  return Array.from({ length: 4 }, (_, bar) => {
    const notes = intent.events.filter(
      (e) =>
        e.pitch !== null &&
        Math.floor(((e.time / beat) % Math.min(16, duration)) / 4) === bar,
    );
    let best = -Infinity,
      selected = preferred[bar];
    for (let index = 0; index < candidates.length; index++) {
      const pcs = candidates[index].map((note) => note % 12);
      let score = index === preferred[bar] ? 0.25 : 0;
      if (index === previous && bar > 0) score -= 0.12;
      for (const note of notes) {
        const pc = Math.round(note.pitch!) % 12;
        score +=
          (pcs.includes(pc) ? 1 : -0.45) * note.duration * note.confidence;
      }
      if (score > best) {
        best = score;
        selected = index;
      }
    }
    previous = selected;
    return candidates[selected];
  });
}
