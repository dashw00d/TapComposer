/** Whole-take level evidence, before pitch fragments become musical notes.
 * This detects contrast with the room; it is not a syllable/voice classifier.
 * Keep the capture clock intact so rests and overdub alignment survive.
 */
export function voiceActivity(levels: number[]): boolean[] {
  const sorted = levels.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return levels.map(() => false);
  const quiet = sorted[Math.floor(sorted.length * 0.15)];
  const voice = sorted[Math.floor(sorted.length * 0.85)];
  // A continuous or uniformly quiet hum provides no reliable room estimate.
  // In that case leave voicing to the pitch detector rather than erase it.
  const threshold = voice > quiet * 4 ? quiet * 2.5 : 0;
  return levels.map((level) => Number.isFinite(level) && level >= threshold);
}
