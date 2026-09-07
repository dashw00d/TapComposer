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
