import type { Track } from './types';

/** Cleaned monophonic phrases release the previous sound when the next note arrives. */
export function noteEnvelope(track: Track, index: number, release: number) {
  const event = track.events[index];
  let duration = event.duration;
  let attack =
    track.instrument === 'strings' ? Math.min(0.14, duration * 0.4) : 0.003;
  if (
    track.smoother &&
    track.intent.source === 'hum' &&
    track.instrument !== 'drums'
  ) {
    const next = track.events[index + 1];
    const previous = track.events[index - 1];
    // Respect intentional chords and manually overlapping voices.
    const monophonic =
      (!previous || event.time >= previous.time + previous.duration - 0.03) &&
      (!next || next.time >= event.time + event.duration - 0.03);
    if (monophonic) {
      if (next) {
        duration = Math.min(
          duration,
          Math.max(0.02, next.time - event.time - 0.008),
        );
        release = Math.min(
          release,
          Math.max(0.025, next.time - event.time - duration + 0.035),
        );
      }
      if (track.instrument === 'strings')
        attack = Math.min(0.055, duration * 0.2);
      else if (track.instrument === 'synth')
        attack = Math.min(0.012, duration * 0.1);
    }
  }
  return { duration, release, attack };
}
