import type { SectionPart } from './types';
export interface GainPoint {
  time: number;
  gain: number;
}
export function gainAt(points: GainPoint[], time: number): number {
  const right = points.findIndex((p) => p.time > time);
  if (right === 0) return points[0].gain;
  if (right < 0) return points.at(-1)?.gain ?? 1;
  const a = points[right - 1],
    b = points[right];
  return a.gain + ((b.gain - a.gain) * (time - a.time)) / (b.time - a.time);
}
export function seekExpression(
  points: GainPoint[] | undefined,
  cut: number,
): GainPoint[] | undefined {
  return points?.length
    ? [
        { time: 0, gain: gainAt(points, cut) },
        ...points
          .filter((p) => p.time > cut)
          .map((p) => ({ ...p, time: p.time - cut })),
      ]
    : undefined;
}
/** Envelope times are relative to this note; source recordings stay untouched. */
export function sectionExpression(
  setting: SectionPart,
  at: number,
  end: number,
  sectionBeats: number,
  beat: number,
): GainPoint[] | undefined {
  const fadeIn = setting.fadeInBeats ?? 0,
    fadeOut = setting.fadeOutBeats ?? 0;
  if (!fadeIn && !fadeOut) return undefined;
  const gain = (t: number) =>
    Math.max(
      0,
      Math.min(
        1,
        fadeIn ? (t - setting.offsetBeats) / fadeIn : 1,
        fadeOut ? (sectionBeats - t) / fadeOut : 1,
      ),
    );
  const crossing =
    fadeIn && fadeOut
      ? (fadeIn * sectionBeats + fadeOut * setting.offsetBeats) /
        (fadeIn + fadeOut)
      : at;
  const times = [
    ...new Set(
      [
        at,
        end,
        setting.offsetBeats + fadeIn,
        sectionBeats - fadeOut,
        crossing,
      ].filter((t) => t >= at && t <= end),
    ),
  ].sort((a, b) => a - b);
  return times.map((t) => ({ time: (t - at) * beat, gain: gain(t) }));
}
