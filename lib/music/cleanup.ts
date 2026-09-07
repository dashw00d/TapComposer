import type { Track } from './types';
export function editNoteGeometry(
  track: Track,
  index: number,
  change: Partial<Track['events'][number]>,
): Track {
  if (!track.events[index]) return track;
  const event = { ...track.events[index], ...change };
  event.time = Math.max(0, Math.min(119.98, event.time));
  event.note = Math.max(0, Math.min(127, Math.round(event.note)));
  event.duration = Math.max(0.02, Math.min(120 - event.time, event.duration));
  const events = track.events.map((e, i) => (i === index ? event : e));
  return {
    ...track,
    events,
    duration: Math.max(track.duration, event.time + event.duration),
    pinned: true,
    edited: true,
  };
}
export type NoteEdit =
  | 'higher'
  | 'lower'
  | 'earlier'
  | 'later'
  | 'shorter'
  | 'longer'
  | 'remove';
export function editNote(track: Track, index: number, action: NoteEdit): Track {
  const note = track.events[index];
  if (!note) return track;
  if (action === 'remove')
    return {
      ...track,
      events: track.events.filter((_, i) => i !== index),
      pinned: true,
      edited: true,
    };
  return editNoteGeometry(track, index, {
    note: note.note + (action === 'higher' ? 1 : action === 'lower' ? -1 : 0),
    time:
      note.time +
      (action === 'later' ? 0.05 : action === 'earlier' ? -0.05 : 0),
    duration:
      note.duration +
      (action === 'longer' ? 0.05 : action === 'shorter' ? -0.05 : 0),
  });
}
export function trimQuietEdges(track: Track): Track {
  if (!track.events.length) return track;
  const start = Math.min(...track.events.map((e) => e.time));
  const end = Math.max(...track.events.map((e) => e.time + e.duration));
  return {
    ...track,
    events: track.events.map((e) => ({ ...e, time: e.time - start })),
    duration: end - start,
    pinned: true,
    edited: true,
  };
}

const NOTE_NAMES = [
  'C',
  'C♯',
  'D',
  'D♯',
  'E',
  'F',
  'F♯',
  'G',
  'G♯',
  'A',
  'A♯',
  'B',
];
export function noteName(note: number, octave = true): string {
  const pitch = Math.max(0, Math.min(127, Math.round(note)));
  return NOTE_NAMES[pitch % 12] + (octave ? Math.floor(pitch / 12) - 1 : '');
}
export function inSongKey(
  note: number,
  context?: { key: number; mode: 'major' | 'minor' } | null,
): boolean {
  if (!context) return true;
  const scale =
    context.mode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return scale.includes((((Math.round(note) - context.key) % 12) + 12) % 12);
}
export function guidedPitch(
  note: number,
  context?: { key: number; mode: 'major' | 'minor' } | null,
  direction = 0,
): number {
  const pitch = Math.max(0, Math.min(127, Math.round(note)));
  for (let distance = 0; distance <= 12; distance++) {
    for (const candidate of direction > 0
      ? [pitch + distance, pitch - distance]
      : [pitch - distance, pitch + distance]) {
      if (candidate >= 0 && candidate <= 127 && inSongKey(candidate, context))
        return candidate;
    }
  }
  return pitch;
}
export function magneticTime(time: number, beat: number): number {
  return Math.max(0, Math.round(time / (beat / 4)) * (beat / 4));
}
export function stepTime(
  time: number,
  beat: number,
  direction: number,
): number {
  const grid = beat / 4;
  return Math.max(
    0,
    (direction > 0
      ? Math.floor(time / grid + 1e-7) + 1
      : Math.ceil(time / grid - 1e-7) - 1) * grid,
  );
}
