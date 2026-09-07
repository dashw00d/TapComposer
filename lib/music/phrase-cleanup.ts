import type { MusicalIntent, IntentEvent, SongContext } from './types';
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const end = (e: IntentEvent) => e.time + e.duration;

/** A reversible interpretation of a hum; source events and recording are never edited. */
export function cleanHumIntent(
  intent: MusicalIntent,
  context: SongContext,
): MusicalIntent {
  if (intent.source !== 'hum' || !intent.events.length) return intent;
  // Polyphonic manual ideas are outside this monophonic cleanup's scope.
  if (
    intent.events.some(
      (e, i) => i > 0 && e.time < end(intent.events[i - 1]) - 0.025,
    )
  )
    return intent;
  const events = intent.events.map((e) => ({ ...e }));
  for (let i = 1; i < events.length - 1; i++) {
    const before = events[i - 1],
      current = events[i],
      after = events[i + 1];
    if (before.pitch === null || current.pitch === null || after.pitch === null)
      continue;
    const pitch = median([before.pitch, after.pitch]);
    const weak =
      current.confidence <
        Math.min(before.confidence, after.confidence) - 0.12 ||
      current.intensity < Math.min(before.intensity, after.intensity) * 0.5;
    // Only absorb a weak interruption inside a sustained pitch. Real trills and
    // repeated syllables with silence/strong attacks retain their own notes.
    if (
      current.duration <= 0.1 &&
      current.duration < Math.min(before.duration, after.duration) * 0.4 &&
      Math.abs(before.pitch - after.pitch) < 0.55 &&
      (Math.abs(current.pitch - pitch) <= 2 ||
        (Math.abs(Math.abs(current.pitch - pitch) - 12) < 0.45 &&
          current.confidence < 0.7 &&
          Math.min(before.confidence, after.confidence) > 0.85)) &&
      weak &&
      current.time - end(before) < 0.035 &&
      after.time - end(current) < 0.035
    ) {
      const duration = end(after) - before.time;
      events.splice(i - 1, 3, {
        ...before,
        duration,
        pitch,
        confidence:
          (before.confidence * before.duration +
            after.confidence * after.duration) /
          (before.duration + after.duration),
        intensity:
          (before.intensity * before.duration +
            after.intensity * after.duration) /
          (before.duration + after.duration),
      });
      i = Math.max(0, i - 2);
    }
  }
  // Tighten only an already-consistent pulse, including triplets. Preserve the
  // first onset and move any other onset by at most 18 ms, never an eighth-note leap.
  if (events.length >= 5 && context.tempo > 0) {
    const beat = 60 / context.tempo,
      anchor = events[0].time;
    const candidates = [2, 3, 4].map((divisor) => {
      const step = beat / divisor;
      const errors = events
        .slice(1)
        .map((e) =>
          Math.abs(
            Math.round((e.time - anchor) / step) * step + anchor - e.time,
          ),
        );
      return {
        step,
        fits: errors.filter((e) => e <= 0.035).length / errors.length,
        error: median(errors),
      };
    });
    const grid = candidates.find((c) => c.fits >= 0.8 && c.error <= 0.025);
    if (grid)
      for (let i = 1; i < events.length; i++) {
        const e = events[i];
        const difference =
          anchor +
          Math.round((e.time - anchor) / grid.step) * grid.step -
          e.time;
        if (Math.abs(difference) > 0.035 || Math.abs(difference) < 1e-8)
          continue;
        const shift = Math.max(-0.018, Math.min(0.018, difference * 0.45));
        if (
          e.time + shift <= events[i - 1].time + 0.04 ||
          (events[i + 1] && e.time + shift >= events[i + 1].time - 0.04)
        )
          continue;
        e.time += shift;
      }
  }
  const level = median(events.map((e) => e.intensity));
  for (let i = 0; i < events.length; i++) {
    const e = events[i],
      next = events[i + 1];
    // Compress loudness variation while preserving intentional accents.
    e.intensity = Math.max(
      0.2,
      Math.min(1, level + (e.intensity - level) * 0.6),
    );
    if (!next) continue;
    const gap = next.time - end(e);
    if (gap > 0 && gap < Math.min(0.035, e.duration * 0.1))
      e.duration = next.time - e.time;
    if (end(e) > next.time + 1e-8)
      e.duration = Math.max(0.02, next.time - e.time);
  }
  return { ...intent, events };
}
