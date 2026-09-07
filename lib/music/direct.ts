import { changeInstrument } from './composition';
import { chordAt } from './harmony';
import type { Instrument, PerformanceEvent, Song, Track } from './types';
export type Direction = 'simpler' | 'movement' | 'answer' | 'later' | 'space';
export const DIRECTIONS: { id: Direction; label: string }[] = [
  { id: 'simpler', label: 'Simpler' },
  { id: 'movement', label: 'More movement' },
  { id: 'answer', label: 'Answer the melody' },
  { id: 'later', label: 'Come in later' },
  { id: 'space', label: 'Leave more space' },
];
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
export function directPart(
  song: Song,
  id: string,
  direction: Direction,
  explicitEdit = false,
): Song {
  const track = song.tracks.find((t) => t.id === id);
  if (!track || (track.pinned && !explicitEdit) || !song.context) return song;
  if (
    !explicitEdit &&
    song.sections?.some((s) => s.pinned && s.trackIds.includes(id))
  )
    return song;
  if (direction === 'later' && !song.sections?.length && !song.clips?.length)
    return song;
  const beat = 60 / (track.sourceTempo ?? song.context?.tempo ?? 100);
  let events = track.events.map((e) => ({ ...e }));
  const starts = [
    ...new Set(events.map((e) => Math.round((e.time / beat) * 16) / 16)),
  ].sort((a, b) => a - b);
  if (direction === 'simpler' || direction === 'space') {
    const keep = new Set(
      starts.filter((_, i) => i % (direction === 'space' ? 3 : 2) === 0),
    );
    events = events
      .filter((e) => keep.has(Math.round((e.time / beat) * 16) / 16))
      .map((e) => ({
        ...e,
        duration:
          direction === 'space' ? Math.min(e.duration, 0.6 * beat) : e.duration,
      }));
  }
  if (direction === 'movement') {
    const additions: PerformanceEvent[] = [];
    for (const event of events) {
      const at = event.time + 0.5 * beat;
      if (
        at + 0.1 * beat >= track.duration ||
        events.some((e) => Math.abs(e.time - at) < 0.2 * beat)
      )
        continue;
      const chord = chordAt(
        at / beat,
        song.context!,
        song.compose?.variation ?? 0,
      ).map((n) => clamp(n + Math.round((event.note - n) / 12) * 12, 0, 127));
      const note =
        track.instrument === 'drums'
          ? 42
          : chord.reduce(
              (best, n) =>
                Math.abs(n - event.note) < Math.abs(best - event.note)
                  ? n
                  : best,
              chord[0],
            );
      if (additions.some((e) => e.time === at && e.note === note)) continue;
      additions.push({
        ...event,
        time: at,
        note,
        duration: Math.min(0.35 * beat, event.duration, track.duration - at),
        velocity: event.velocity * 0.75,
      });
    }
    events = [...events, ...additions]
      .sort((a, b) => a.time - b.time)
      .slice(0, 10000);
  }
  if (direction === 'answer') {
    const melody = song.tracks.find(
      (t) =>
        t.id !== id &&
        !t.generated &&
        t.intent.events.some((e) => e.pitch !== null),
    );
    if (!melody) return song;
    const melodyBeat = 60 / (melody.sourceTempo ?? song.context?.tempo ?? 100);
    const source = melody.events.filter(
      (e, i, list) =>
        i === list.length - 1 ||
        list[i + 1].time - e.time - e.duration > melodyBeat * 0.4,
    );
    events = source.flatMap((e, i) => {
      const at = ((e.time + e.duration) / melodyBeat) * beat + 0.25 * beat;
      if (at >= track.duration - 0.1 * beat) return [];
      const chord = chordAt(
        at / beat,
        song.context!,
        song.compose?.variation ?? 0,
      );
      const note =
        track.instrument === 'drums'
          ? 38
          : chord[i % chord.length] + (track.instrument === 'bass' ? -12 : 0);
      return [
        {
          time: at,
          note,
          duration: Math.min(0.6 * beat, track.duration - at),
          velocity: 0.6,
        },
      ];
    });
    if (!events.length) return song;
  }
  return {
    ...song,
    tracks: song.tracks.map((t) =>
      t.id === id ? { ...t, events, pinned: true, edited: true } : t,
    ),
    clips:
      direction === 'later'
        ? song.clips?.map((clip) =>
            clip.trackId === id
              ? {
                  ...clip,
                  startBeat: Math.min(
                    512 - clip.lengthBeats,
                    clip.startBeat + 4,
                  ),
                }
              : clip,
          )
        : song.clips,
    sections:
      direction === 'later'
        ? song.sections?.map((s) =>
            s.pinned && !explicitEdit
              ? s
              : {
                  ...s,
                  parts: {
                    ...s.parts,
                    [id]: {
                      repeat: true,
                      transpose: 0,
                      ...s.parts?.[id],
                      offsetBeats: clamp(
                        (s.parts?.[id]?.offsetBeats ?? 0) + 4,
                        0,
                        s.bars * 4 - 1,
                      ),
                    },
                  },
                },
          )
        : song.sections,
  };
}
export function forkDirection(song: Song, name: string): Song {
  return {
    ...song,
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 60) || 'Another direction',
    familyId: song.familyId ?? song.id,
    branchedFrom: song.id,
    updatedAt: Date.now(),
  };
}
export function layerIdea(
  song: Song,
  track: Track,
  instruments: Instrument[],
  context: NonNullable<Song['context']>,
): Track[] {
  return [...new Set(instruments)]
    .slice(
      0,
      Math.max(0, 24 - song.tracks.filter((t) => t.id !== track.id).length),
    )
    .map((instrument, index) => ({
      ...changeInstrument(track, instrument, context),
      id: index === 0 ? track.id : crypto.randomUUID(),
      name:
        instruments.length === 1 && track.instrument === instrument
          ? track.name
          : `${instrument[0].toUpperCase() + instrument.slice(1)} idea`,
    }));
}
export function resizeSection(song: Song, id: string, bars: number): Song {
  const others = (song.sections ?? [])
    .filter((s) => s.id !== id)
    .reduce((n, s) => n + s.bars, 0);
  const bounded = clamp(
    Math.round(bars / 2) * 2,
    2,
    Math.min(32, 128 - others),
  );
  return {
    ...song,
    sections: song.sections?.map((s) =>
      s.id === id
        ? {
            ...s,
            bars: bounded,
            parts: Object.fromEntries(
              Object.entries(s.parts ?? {}).map(([id, p]) => [
                id,
                {
                  ...p,
                  offsetBeats: Math.min(p.offsetBeats, bounded * 4 - 1),
                  fadeInBeats: Math.min(p.fadeInBeats ?? 0, bounded * 4),
                  fadeOutBeats: Math.min(p.fadeOutBeats ?? 0, bounded * 4),
                },
              ]),
            ),
          }
        : s,
    ),
  };
}
export function reorderSection(song: Song, id: string, targetId: string): Song {
  const sections = [...(song.sections ?? [])];
  const from = sections.findIndex((s) => s.id === id),
    to = sections.findIndex((s) => s.id === targetId);
  if (from < 0 || to < 0 || from === to) return song;
  sections.splice(to, 0, sections.splice(from, 1)[0]);
  return { ...song, sections };
}
export function shapeJourney(
  song: Song,
  energies: number[],
  resize = false,
): Song {
  let next: Song = {
    ...song,
    sections: song.sections?.map((s, i) => {
      if (s.pinned) return s;
      const energy = clamp(energies[i] ?? s.energy, 0.1, 1);
      const trackIds = song.tracks
        .filter(
          (t) =>
            !t.generated ||
            t.pinned ||
            (t.instrument === 'drums'
              ? energy >= 0.55
              : t.instrument === 'bass'
                ? energy >= 0.3
                : energy >= 0.2),
        )
        .map((t) => t.id);
      return { ...s, energy, trackIds };
    }),
  };
  if (resize)
    for (const s of next.sections ?? [])
      if (!s.pinned) next = resizeSection(next, s.id, 4 + s.energy * 8);
  return next;
}
export function originLabel(track: Track): string {
  return track.generated
    ? track.edited
      ? 'Suggested · shaped by you'
      : 'Suggested accompaniment'
    : track.edited
      ? 'Your idea · shaped by you'
      : track.intent.source === 'hum'
        ? 'Your melody'
        : 'Your rhythm';
}

/** Releasing a shared part should not silently release the other protected parts. */
export function setPartProtection(
  song: Song,
  id: string,
  pinned: boolean,
): Song {
  const shared = new Set(
    !pinned
      ? song.sections
          ?.filter((s) => s.pinned && s.trackIds.includes(id))
          .flatMap((s) => s.trackIds)
      : [],
  );
  return {
    ...song,
    tracks: song.tracks.map((t) =>
      t.id === id
        ? { ...t, pinned }
        : shared.has(t.id)
          ? { ...t, pinned: true }
          : t,
    ),
    sections: song.sections?.map((s) =>
      !pinned && s.pinned && s.trackIds.includes(id)
        ? { ...s, pinned: false }
        : s,
    ),
  };
}
