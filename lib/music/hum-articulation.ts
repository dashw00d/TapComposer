import type { PitchFrame } from './analyze';
import type { IntentEvent } from './types';
const median = (xs: number[]) =>
  xs.filter(Number.isFinite).sort((a, b) => a - b)[
    Math.floor(xs.filter(Number.isFinite).length / 2)
  ] ?? NaN;
/** A brief pitch dip plus an envelope gesture can mark a repeated syllable
 * even when the voice never goes silent. Neither cue alone is sufficient. */
export function repeatedHumAttacks(frames: PitchFrame[], hop: number) {
  const attacks: number[] = [];
  const n = (seconds: number) => Math.max(1, Math.round(seconds / hop));
  for (let i = n(0.18); i < frames.length - n(0.18); i++) {
    const f = frames[i];
    if (!Number.isFinite(f.pitch)) continue;
    if (
      frames
        .slice(i - n(0.04), i + n(0.04) + 1)
        .some((x) => Number.isFinite(x.pitch) && x.pitch < f.pitch)
    )
      continue;
    const before = median(
      frames.slice(i - n(0.16), i - n(0.06)).map((x) => x.pitch),
    );
    const after = median(
      frames.slice(i + n(0.06), i + n(0.16)).map((x) => x.pitch),
    );
    if (
      !Number.isFinite(before + after) ||
      Math.abs(before - after) > 0.85 ||
      Math.min(before, after) - f.pitch < 0.5
    )
      continue;
    // Require an envelope gesture as well as pitch deflection.
    const left = frames.slice(i - n(0.14), i - n(0.02));
    const during = frames.slice(i - n(0.02), i + n(0.06));
    const minimum = Math.min(...left.map((x) => x.rms));
    const peak = Math.max(...during.map((x) => x.rms));
    const valley =
      f.rms /
      Math.min(
        Math.max(...left.map((x) => x.rms)),
        Math.max(...frames.slice(i + n(0.02), i + n(0.14)).map((x) => x.rms)),
      );
    if (peak < minimum * 1.1 && valley > 0.6) continue;
    if (f.confidence > 0.9) continue;
    let start = i;
    while (
      start > i - n(0.12) &&
      Number.isFinite(frames[start - 1].pitch) &&
      frames[start - 1].pitch < Math.min(before, after) - 0.25
    )
      start--;
    let end = i;
    while (
      end < i + n(0.14) &&
      Number.isFinite(frames[end + 1].pitch) &&
      frames[end + 1].pitch < after - 0.25
    )
      end++;
    if ((end - start + 1) * hop > 0.24) continue;
    if (attacks.length && frames[start].time - attacks.at(-1)! < 0.16) continue;
    attacks.push(frames[start].time);
    i = end;
  }
  return attacks;
}
/** Describe gradual settling for reversible cleanup; never rewrite the raw
 * pitch or merge attacks in the detector itself. */
export function annotateHumDrift(
  events: IntentEvent[],
  frames: PitchFrame[],
  hop: number,
) {
  return events.map((b, i) => {
    if (!i) return b;
    const a = events[i - 1];
    const distance = Math.abs(a.pitch! - b.pitch!);
    if (
      b.time - a.time - a.duration > 0.04 ||
      distance > 1.5 ||
      distance < 0.3 ||
      a.duration > 0.5
    )
      return b;
    const contour = frames
      .filter(
        (f) =>
          f.time >= a.time + 0.06 &&
          f.time < b.time &&
          Number.isFinite(f.pitch),
      )
      .map((f) => f.pitch)
      .sort((a, b) => a - b);
    if (
      contour.length < 4 ||
      contour[Math.floor(contour.length * 0.9)] -
        contour[Math.floor(contour.length * 0.1)] <
        0.4
    )
      return b;
    const window = frames.filter(
      (f) =>
        f.time >= b.time - 0.12 &&
        f.time <= b.time + 0.08 &&
        Number.isFinite(f.pitch),
    );
    if (window.length < 4) return b;
    let largest = 0;
    for (let j = 1; j < window.length; j++)
      largest = Math.max(
        largest,
        Math.abs(window[j].pitch - window[j - 1].pitch),
      );
    if ((largest * 0.02) / hop >= distance * 0.65) return b;
    const left = frames
      .filter((f) => f.time >= b.time - 0.12 && f.time < b.time)
      .map((f) => f.rms);
    const right = frames
      .filter((f) => f.time >= b.time && f.time < b.time + 0.1)
      .map((f) => f.rms);
    if (
      !left.length ||
      !right.length ||
      Math.max(...right) > Math.min(...left) * 1.25
    )
      return b;
    return { ...b, pitchDrift: true };
  });
}

export function splitHumAttacks(
  events: IntentEvent[],
  frames: PitchFrame[],
  hop: number,
) {
  const attacks = repeatedHumAttacks(frames, hop);
  return events.flatMap((event) => {
    const cuts = [event.time];
    for (const at of attacks)
      if (at - cuts.at(-1)! >= 0.16 && event.time + event.duration - at >= 0.16)
        cuts.push(at);
    cuts.push(event.time + event.duration);
    return cuts
      .slice(0, -1)
      .map((time, i) => ({ ...event, time, duration: cuts[i + 1] - time }));
  });
}
