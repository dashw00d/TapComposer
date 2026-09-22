import type { MusicalIntent, IntentEvent, SongContext } from './types';
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const end = (e: IntentEvent) => e.time + e.duration;

/** Pitch confidence does not measure the singer's intention. Absorb short
 * settling fragments, but preserve breaths and similarly sized syllables. */
export function stabilizeHum(intent: MusicalIntent): MusicalIntent {
  if (intent.source !== 'hum' || !intent.events.length) return intent;
  const events = intent.events
    .map((e) => ({ ...e }))
    .sort((a, b) => a.time - b.time);
  if (events.some((e, i) => i > 0 && e.time < end(events[i - 1]) - 0.025))
    return intent;
  // Use contour evidence from recognition, rather than the score or key, to
  // combine gradual settling with no new vocal attack. Raw intent is retained.
  for (let i = 1; i < events.length; i++) {
    const before = events[i - 1],
      after = events[i];
    if (
      !after.pitchDrift ||
      before.pitch === null ||
      after.pitch === null ||
      after.time - end(before) > 0.04 ||
      Math.abs(after.pitch - before.pitch) > 2
    )
      continue;
    const weight = before.duration + after.duration;
    if (weight <= 0) continue;
    before.pitch =
      (before.pitch * before.duration + after.pitch * after.duration) / weight;
    before.confidence =
      (before.confidence * before.duration +
        after.confidence * after.duration) /
      weight;
    before.duration = end(after) - before.time;
    events.splice(i--, 1);
  }
  for (let i = 0; i < events.length; i++) {
    const fragment = events[i];
    if (fragment.pitch === null || fragment.duration > 0.18 + 1e-8) continue;
    const candidates = [i - 1, i + 1]
      .filter((index) => {
        const target = events[index];
        if (
          !target ||
          target.pitch === null ||
          target.duration < fragment.duration * 2.2
        )
          return false;
        const gap =
          index < i ? fragment.time - end(target) : target.time - end(fragment);
        const distance = Math.abs(fragment.pitch! - target.pitch);
        return (
          gap < 0.04 &&
          gap >= -0.025 &&
          (distance <= 2.5 ||
            (Math.abs(distance - 12) < 0.5 && fragment.confidence < 0.7))
        );
      })
      .sort((a, b) => events[b].duration - events[a].duration);
    const index = candidates[0];
    if (index === undefined) continue;
    const target = events[index];
    const first = Math.min(fragment.time, target.time);
    target.duration = Math.max(end(fragment), end(target)) - first;
    target.time = first;
    events.splice(i, 1);
    // A middle wobble may have split a single sustained note into two halves.
    const at = index < i ? index : index - 1;
    const before = events[at - 1],
      after = events[at + 1];
    if (
      index > i &&
      before &&
      before.pitch !== null &&
      Math.abs(before.pitch - target.pitch!) < 0.55 &&
      target.time - end(before) < 0.04
    ) {
      target.duration = end(target) - before.time;
      target.time = before.time;
      events.splice(at - 1, 1);
    } else if (
      index < i &&
      after &&
      after.pitch !== null &&
      Math.abs(after.pitch - target.pitch!) < 0.55 &&
      after.time - end(target) < 0.04
    ) {
      target.duration = end(after) - target.time;
      events.splice(at + 1, 1);
    }
    i = Math.max(-1, at - 2);
  }
  return { ...intent, events };
}

/** Reversible, forgiving rhythm interpretation; raw intent and PCM stay intact. */
export function cleanHumIntent(
  intent: MusicalIntent,
  context: SongContext,
): MusicalIntent {
  if (intent.source !== 'hum' || !intent.events.length) return intent;
  const stabilized = stabilizeHum(intent);
  if (
    stabilized.events.some(
      (e, i, list) => i > 0 && e.time < end(list[i - 1]) - 0.025,
    )
  )
    return intent;
  const events = stabilized.events.map((e) => ({ ...e }));
  const beat = 60 / Math.max(40, context.tempo);
  const anchor = events[0].time;
  const intervals = events.slice(1).map((e, i) => e.time - events[i].time);
  // Prefer eighth notes; admit sixteenths for fast phrases and triplets when
  // the whole phrase supports them. Never mix grids note by note.
  // Score adjacent intervals: a late first note must not make an otherwise
  // straight phrase look like triplets. Prefer the coarser grid when tied.
  const score = (step: number) =>
    intervals.reduce((sum, interval) => {
      const units = interval / step;
      return sum + Math.abs(units - Math.round(units)) * step;
    }, 0) / Math.max(1, intervals.length);
  let step = beat / 2;
  if (intervals.length && median(intervals) < beat * 0.35) step = beat / 4;
  else if (
    intervals.filter((t) => t < beat * 0.4).length >= 2 &&
    score(beat / 4) < score(step) * 0.55
  )
    step = beat / 4;
  if (
    events.length >= 4 &&
    intervals.filter(
      (t) =>
        Math.abs(t / (beat / 3) - Math.round(t / (beat / 3))) * (beat / 3) <
        beat * 0.07,
    ).length >=
      intervals.length * 0.75 &&
    score(beat / 3) < score(step) * 0.6
  )
    step = beat / 3;
  // Prefer whole beats for a slow, straight phrase when finer divisions add
  // little explanatory value. Duration/rest resolution remains finer.
  const onsetStep =
    step === beat / 2 &&
    intervals.length &&
    intervals.every((t) => t >= beat * 0.7) &&
    score(beat) <= score(step) + beat * 0.08
      ? beat
      : step;
  const level = Math.max(0.01, median(events.map((e) => e.intensity)));
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    // Distinct syllables never collapse onto the same grid position.
    const previous = stabilized.events[i - 1];
    const pause = previous ? e.time - end(previous) : 0;
    const clearRest = pause + 1e-8 >= Math.max(0.16, step * 0.6);
    const spacing = clearRest
      ? (Math.max(1, Math.round(previous.duration / step)) +
          Math.max(1, Math.round(pause / step))) *
        step
      : Math.max(1, Math.round((intervals[i - 1] ?? 0) / onsetStep)) *
        onsetStep;
    e.time = i ? events[i - 1].time + spacing : anchor;
    e.duration = Math.max(step, Math.round(e.duration / step) * step);
    e.pitch = e.pitch === null ? null : Math.round(e.pitch);
    e.intensity = Math.max(
      0.35,
      Math.min(0.95, 0.7 + (e.intensity / level - 1) * 0.2),
    );
  }
  for (let i = 0; i < events.length - 1; i++) {
    const spacing = events[i + 1].time - events[i].time;
    const gap = stabilized.events[i + 1].time - end(stabilized.events[i]);
    // Fit the *rest* as well as the attacks. Independent rounding of note
    // lengths can otherwise erase a deliberate breath or leave tiny holes.
    // Short articulatory gaps join; clear rests retain at least one grid unit
    // when there is room. Distinct syllables still have separate note attacks.
    const rest =
      gap + 1e-8 >= Math.max(0.16, step * 0.6)
        ? Math.max(step, Math.round(gap / step) * step)
        : 0;
    events[i].duration = Math.max(
      step,
      spacing - Math.min(rest, spacing - step),
    );
  }
  return { ...intent, events };
}
