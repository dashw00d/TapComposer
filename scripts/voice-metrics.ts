/** Offline evaluation against human annotations. Never shifts/transposes references. */
export interface Note {
  time: number;
  pitch: number;
  duration: number;
}
export function noteScore(
  reference: Note[],
  predicted: Note[],
  tolerance = 0.1,
) {
  // Maximum bipartite matching prevents duplicate predictions claiming one note.
  const edges = reference.map((r) =>
    predicted.flatMap((p, i) =>
      Math.abs(p.time - r.time) <= tolerance + 1e-8 &&
      Math.abs(p.pitch - r.pitch) <= 0.5 + 1e-8
        ? [i]
        : [],
    ),
  );
  const owners = new Map<number, number>();
  function match(r: number, seen: Set<number>): boolean {
    for (const p of edges[r]) {
      if (seen.has(p)) continue;
      seen.add(p);
      if (!owners.has(p) || match(owners.get(p)!, seen)) {
        owners.set(p, r);
        return true;
      }
    }
    return false;
  }
  reference.forEach((_, i) => match(i, new Set()));
  const hits = owners.size;
  return {
    hits,
    reference: reference.length,
    predicted: predicted.length,
    precision: hits / Math.max(1, predicted.length),
    recall: hits / Math.max(1, reference.length),
    f1: (2 * hits) / Math.max(1, reference.length + predicted.length),
  };
}
export function frameScore(
  reference: number[][],
  frames: { time: number; pitch: number }[],
) {
  let voiced = 0,
    correct = 0,
    detected = 0,
    falseVoiced = 0,
    silent = 0,
    at = 0;
  for (const [time, hz] of reference) {
    while (
      at + 1 < frames.length &&
      Math.abs(frames[at + 1].time - time) < Math.abs(frames[at].time - time)
    )
      at++;
    const pitch = frames[at]?.pitch ?? NaN;
    const active =
      Number.isFinite(pitch) &&
      Math.abs((frames[at]?.time ?? Infinity) - time) <= 0.011;
    if (hz > 0) {
      voiced++;
      if (active) detected++;
      if (active && Math.abs(pitch - (69 + 12 * Math.log2(hz / 440))) <= 0.5)
        correct++;
    } else {
      silent++;
      if (active) falseVoiced++;
    }
  }
  return {
    voiced,
    correct,
    detected,
    falseVoiced,
    silent,
    pitchRecall: correct / Math.max(1, voiced),
    voiceRecall: detected / Math.max(1, voiced),
    falseVoiceRate: falseVoiced / Math.max(1, silent),
  };
}
