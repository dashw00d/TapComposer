import { sectionExpression } from './expression';
import { chordAt, inferHarmony } from './harmony';
import { buildIntent } from './analyze';
import { inferContext, resolveIntent } from './resolve';
import type {
  ComposeSettings,
  Feel,
  Instrument,
  PerformanceEvent,
  Song,
  SongContext,
  SongSection,
  Track,
} from './types';

export const DEFAULT_COMPOSE: ComposeSettings = {
  feel: 'easy',
  energy: 0.6,
  variation: 0,
};
export const FEELS: { id: Feel; label: string; description: string }[] = [
  {
    id: 'easy',
    label: 'Easygoing',
    description: 'Warm chords, a relaxed pocket.',
  },
  {
    id: 'bright',
    label: 'Feel good',
    description: 'Light, bouncy, a little brighter.',
  },
  {
    id: 'dreamy',
    label: 'Daydream',
    description: 'Soft edges and room to breathe.',
  },
  {
    id: 'driving',
    label: 'Full of life',
    description: 'A stronger pulse, more movement.',
  },
];
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export const beatSeconds = (context: SongContext | null) =>
  60 / (context?.tempo ?? 100);
export function keepIdea(song: Song, track: Track, context: SongContext): Song {
  if (song.harmonyPinned && song.context) context = song.context;
  const replacing = song.tracks.some((part) => part.id === track.id);
  return composeSong({
    ...song,
    context,
    sections: song.sections?.map((section) => ({
      ...section,
      trackIds:
        replacing || section.pinned
          ? section.trackIds
          : [...section.trackIds, track.id],
    })),
    tracks: replacing
      ? song.tracks.map((part) =>
          part.id === track.id ? { ...track, generated: false } : part,
        )
      : [...song.tracks, { ...track, generated: false }],
  });
}
export const patternBeats = (track: Track, context: SongContext | null) =>
  Math.max(
    4,
    Math.round(
      track.duration / (60 / (track.sourceTempo ?? context?.tempo ?? 100)) / 4,
    ) * 4,
  );
function rhythmFrom(track: Track | null, beat: number): number[] {
  if (!track?.intent.events.length) return [0, 1, 2, 3];
  const pattern = track.intent.events
    .map((e) => Math.round((e.time / beat) * 2) / 2)
    .filter((t) => t < 4);
  return Array.from(new Set([0, ...pattern])).slice(0, 12);
}
function generatedTrack(
  instrument: Instrument,
  events: PerformanceEvent[],
  song: Song,
): Track {
  const beat = beatSeconds(song.context);
  const intent = buildIntent(
    instrument === 'drums' ? 'touch' : 'hum',
    events.map((e) => ({
      time: e.time,
      duration: e.duration,
      pitch: instrument === 'drums' ? null : e.note,
      intensity: e.velocity,
      confidence: 1,
    })),
    beat * 16,
  );
  const names: Record<Instrument, string> = {
    piano: 'Warm chords',
    drums: 'The groove',
    bass: 'The heartbeat',
    guitar: 'Easy strums',
    strings: 'A little atmosphere',
    synth: 'A little sparkle',
  };
  return {
    id: crypto.randomUUID(),
    name: names[instrument],
    instrument,
    intent,
    events,
    duration: 16 * beat,
    original: null,
    muted: false,
    smoother: false,
    generated: true,
    sourceTempo: song.context?.tempo ?? 100,
    volume:
      instrument === 'strings' ? 0.48 : instrument === 'drums' ? 0.85 : 0.7,
    pan: instrument === 'guitar' ? -0.22 : instrument === 'strings' ? 0.25 : 0,
  };
}
/** Symbolic arranger: preserve the user's source, compose supporting roles, then structure a song. */
export function composeSong(
  input: Song,
  options: Partial<ComposeSettings> = {},
): Song {
  const settings = { ...DEFAULT_COMPOSE, ...input.compose, ...options };
  const protectedIds = new Set(
    input.sections?.filter((s) => s.pinned).flatMap((s) => s.trackIds) ?? [],
  );
  let originals = input.tracks.filter(
    (t) => !t.generated || t.pinned || protectedIds.has(t.id),
  );
  if (!originals.length) return input;
  const melodic = originals.find((t) =>
    t.intent.events.some((e) => e.pitch !== null),
  );
  let context = input.context ?? inferContext((melodic ?? originals[0]).intent);
  if (input.harmonyPinned && !context.chords?.length) {
    context = {
      ...context,
      chords: [0, 4, 8, 12].map((at) =>
        chordAt(at, context, input.compose?.variation ?? 0),
      ),
    };
  }
  if (melodic && !input.harmonyPinned) {
    const sourceContext = {
      ...context,
      tempo: melodic.sourceTempo ?? context.tempo,
    };
    context = {
      ...context,
      chords: inferHarmony(melodic.intent, sourceContext),
    };
  }
  // Rhythmic ideas contain no chosen pitches: keep their timing, but let their
  // chord interpretation follow new melodic context as the song takes shape.
  originals = originals.map((track) => {
    if (
      track.pinned ||
      protectedIds.has(track.id) ||
      input.harmonyPinned ||
      track.instrument === 'drums' ||
      track.intent.events.some((e) => e.pitch !== null)
    )
      return track;
    const resolved = resolveIntent(
      track.intent,
      track.instrument,
      { ...context, tempo: track.sourceTempo ?? context.tempo },
      track.smoother,
      true,
    );
    return {
      ...track,
      ...resolved,
      duration: Math.max(track.duration, resolved.duration),
    };
  });
  const song = { ...input, context };
  const beat = beatSeconds(context),
    variation = settings.variation,
    energy = settings.energy;
  const random = (i: number) => {
    const x = Math.sin((i + variation * 137 + 21) * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  const roles = new Set(originals.map((t) => t.instrument));
  const supporting: Track[] = [];
  const anchor =
    originals.find((t) => t.intent.source !== 'hum') ?? melodic ?? originals[0];
  const rhythm = rhythmFrom(anchor, 60 / (anchor.sourceTempo ?? context.tempo));
  if (!roles.has('drums')) {
    const events: PerformanceEvent[] = [];
    for (let bar = 0; bar < 4; bar++) {
      const kicks =
        settings.feel === 'driving'
          ? [0, 1, 2, 3]
          : Array.from(
              new Set([
                0,
                variation % 2 ? 2 : 2.5,
                ...rhythm
                  .filter((t) => t !== 1 && t !== 3 && t < 4)
                  .slice(0, energy > 0.7 ? 3 : 1),
              ]),
            );
      for (const position of kicks)
        events.push({
          time: (bar * 4 + position) * beat,
          note: 36,
          duration: 0.18,
          velocity: 0.65 + energy * 0.2,
        });
      for (const position of [1, 3])
        events.push({
          time: (bar * 4 + position) * beat,
          note: 38,
          duration: 0.15,
          velocity: settings.feel === 'dreamy' ? 0.4 : 0.55 + energy * 0.22,
        });
      const step = energy > 0.72 ? 0.5 : 1;
      for (let t = 0; t < 4; t += step)
        events.push({
          time:
            (bar * 4 +
              t +
              (t % 1 ? (settings.feel === 'easy' ? 0.055 : 0) : 0)) *
            beat,
          note: 42,
          duration: 0.08,
          velocity: 0.25 + random(bar * 8 + t) * 0.16,
        });
      if (bar === 3 && energy > 0.65)
        for (const t of [3.5, 3.75])
          events.push({
            time: (bar * 4 + t) * beat,
            note: 38,
            duration: 0.1,
            velocity: 0.42,
          });
    }
    supporting.push(generatedTrack('drums', events, song));
  }
  if (!roles.has('bass')) {
    const events: PerformanceEvent[] = [];
    for (let bar = 0; bar < 4; bar++) {
      const chord = chordAt(bar * 4, context, variation);
      const hits =
        energy > 0.7
          ? variation % 2
            ? [0, 0.75, 2.5, 3.5]
            : [0, 1.5, 2, 3.5]
          : settings.feel === 'dreamy'
            ? [0, 2]
            : [0, ...rhythm.filter((t) => t > 0).slice(0, 3)];
      hits.forEach((t, i) =>
        events.push({
          time: (bar * 4 + t) * beat,
          note: chord[i === hits.length - 1 && energy > 0.7 ? 2 : 0] - 12,
          duration:
            Math.min(
              i + 1 < hits.length ? hits[i + 1] - t - 0.08 : 4 - t - 0.08,
              settings.feel === 'dreamy' ? 2 : 0.8,
            ) * beat,
          velocity: 0.66 + (i === 0 ? 0.13 : 0),
        }),
      );
    }
    supporting.push(generatedTrack('bass', events, song));
  }
  const harmony: Instrument =
    settings.feel === 'dreamy'
      ? 'strings'
      : roles.has('piano')
        ? 'guitar'
        : 'piano';
  if (!roles.has(harmony)) {
    const events: PerformanceEvent[] = [];
    for (let bar = 0; bar < 4; bar++) {
      const chord = chordAt(bar * 4, context, variation);
      const hits =
        settings.feel === 'dreamy'
          ? [0]
          : settings.feel === 'bright'
            ? [0, 1.5, 2.5]
            : variation % 2
              ? [0, 1.5, 3]
              : [0, 2];
      for (const t of hits)
        chord.forEach((note, i) =>
          events.push({
            time:
              (bar * 4 + t) * beat + i * (harmony === 'guitar' ? 0.022 : 0.007),
            note:
              note +
              (harmony === 'strings'
                ? 12
                : variation % 3 === 2 && i === 0
                  ? 12
                  : 0),
            duration: (harmony === 'strings' ? 3.8 : 1.3) * beat,
            velocity: 0.43 + energy * 0.15,
          }),
        );
    }
    supporting.push(generatedTrack(harmony, events, song));
  }
  if (!melodic && !roles.has('synth')) {
    // Tap-only songs get an original motif in the inferred scale, paced by the user's taps.
    const events: PerformanceEvent[] = [];
    for (let bar = 0; bar < 4; bar++) {
      const chord = chordAt(bar * 4, context, variation);
      for (const [i, t] of rhythm.entries())
        events.push({
          time: (bar * 4 + t) * beat,
          note: chord[(i + variation + bar) % 3] + 12,
          duration: Math.min(0.75, i % 2 ? 0.35 : 0.65) * beat,
          velocity: 0.58 + (i === 0 ? 0.12 : 0),
        });
    }
    supporting.push(generatedTrack('synth', events, song));
  }
  const tracks = [
    ...originals,
    ...supporting.slice(0, Math.max(0, 24 - originals.length)),
  ];
  // Reuse existing generated IDs, so selections and deliberate section choices remain stable on variation.
  for (const track of supporting) {
    const previous = input.tracks.find(
      (t) => t.generated && t.instrument === track.instrument,
    );
    if (previous) {
      track.id = previous.id;
      track.volume = previous.volume;
      track.pan = previous.pan;
      track.muted = previous.muted;
      track.solo = previous.solo;
    }
  }
  const melodicIds = tracks
    .filter((t) => t.instrument !== 'drums' && t.instrument !== 'bass')
    .map((t) => t.id);
  const all = tracks.map((t) => t.id);
  const fullPhraseBars = Math.max(
    8,
    ...originals.map((track) => patternBeats(track, context) / 4),
  );
  let sections: SongSection[] = [
    {
      id: crypto.randomUUID(),
      name: 'A way in',
      bars: 4,
      energy: 0.5,
      trackIds: melodicIds.length ? melodicIds.slice(0, 2) : all.slice(0, 1),
    },
    {
      id: crypto.randomUUID(),
      name: 'Find the groove',
      bars: fullPhraseBars,
      energy: 0.8,
      trackIds: all,
    },
    {
      id: crypto.randomUUID(),
      name: 'Room to breathe',
      bars: 4,
      energy: 0.5,
      trackIds: tracks.filter((t) => t.instrument !== 'drums').map((t) => t.id),
    },
    {
      id: crypto.randomUUID(),
      name: 'Bring it home',
      bars: fullPhraseBars,
      energy: 1,
      trackIds: all,
    },
    {
      id: crypto.randomUUID(),
      name: 'Let it settle',
      bars: 4,
      energy: 0.45,
      trackIds: melodicIds.length ? melodicIds.slice(0, 2) : all.slice(0, 1),
    },
  ];
  if (input.sections?.length) {
    const existingIds = new Set(input.tracks.map((t) => t.id)),
      nextIds = new Set(tracks.map((t) => t.id));
    const fresh = tracks.filter((t) => !existingIds.has(t.id));
    sections = input.sections.map((section) => {
      if (section.pinned) return section;
      const removed = section.trackIds.filter((id) => !nextIds.has(id));
      const additions = fresh.filter(
        (t) =>
          !t.generated ||
          removed.some((id) => {
            const previous = input.tracks.find((old) => old.id === id);
            return (
              previous?.generated &&
              previous.instrument !== 'drums' &&
              previous.instrument !== 'bass' &&
              t.instrument !== 'drums' &&
              t.instrument !== 'bass'
            );
          }),
      );
      return {
        ...section,
        trackIds: [
          ...section.trackIds.filter((id) => nextIds.has(id)),
          ...additions.map((t) => t.id),
        ],
      };
    });
  }
  return {
    ...song,
    tracks,
    sections,
    compose: settings,
    masterVolume: input.masterVolume ?? 0.85,
    updatedAt: Date.now(),
  };
}
export function sectionLength(song: Song): number {
  return (song.sections ?? []).reduce((sum, s) => sum + s.bars * 4, 0);
}
export function sectionStart(song: Song, id: string): number {
  let start = 0;
  for (const section of song.sections ?? []) {
    if (section.id === id) return start;
    start += section.bars * 4;
  }
  return 0;
}
/** Materialize sections through a shared path for playback, waveform, WAV, MP3, and MIDI. */
export function arrangedTracks(song: Song, onlySection?: string): Track[] {
  const beat = beatSeconds(song.context),
    sections = (song.sections ?? []).filter(
      (s) => !onlySection || s.id === onlySection,
    );
  const anySolo = song.tracks.some((t) => t.solo && !t.muted);
  if (!sections.length)
    return song.tracks.map((t) => {
      const scale =
        (t.sourceTempo ?? song.context?.tempo ?? 100) /
        (song.context?.tempo ?? 100);
      return {
        ...t,
        duration: t.duration * scale,
        events: t.events.map((event) => ({
          ...event,
          time: event.time * scale,
          duration: event.duration * scale,
        })),
        muted: t.muted || (anySolo && !t.solo),
        volume: (t.volume ?? 1) * (song.masterVolume ?? 0.85),
      };
    });
  const length = sections.reduce((sum, s) => sum + s.bars * 4, 0);
  return song.tracks.map((track) => {
    const events: PerformanceEvent[] = [];
    const sourceBeat = 60 / (track.sourceTempo ?? song.context?.tempo ?? 100);
    const patternLength = patternBeats(track, song.context);
    let start = 0;
    for (const section of sections) {
      const sectionBeats = section.bars * 4;
      const setting = section.parts?.[track.id] ?? {
        offsetBeats: 0,
        repeat: true,
        transpose: 0,
      };
      if (section.trackIds.includes(track.id))
        for (
          let cycle = setting.offsetBeats;
          cycle < sectionBeats;
          cycle += setting.repeat ? patternLength : sectionBeats
        )
          for (const event of track.events) {
            const at = cycle + event.time / sourceBeat;
            if (at >= sectionBeats) continue;
            const end = Math.min(
              event.duration / sourceBeat,
              sectionBeats - at,
            );
            events.push({
              ...event,
              note:
                track.instrument === 'drums'
                  ? event.note
                  : clamp(event.note + setting.transpose, 0, 127),
              time: (start + at) * beat,
              duration: Math.max(0.02, end * beat),
              velocity: clamp(
                event.velocity * (0.62 + section.energy * 0.38),
                0.001,
                1,
              ),
              expression: sectionExpression(
                setting,
                at,
                at + end,
                sectionBeats,
                beat,
              ),
            });
          }
      start += sectionBeats;
    }
    return {
      ...track,
      events,
      duration: length * beat,
      muted: track.muted || (anySolo && !track.solo),
      volume: (track.volume ?? 1) * (song.masterVolume ?? 0.85),
    };
  });
}
export function patternTracks(song: Song): Track[] {
  const beat = beatSeconds(song.context),
    anySolo = song.tracks.some((t) => t.solo && !t.muted);
  const length = Math.max(
    16,
    ...song.tracks.map((t) => patternBeats(t, song.context)),
  );
  return song.tracks.map((track) => {
    const sourceBeat = 60 / (track.sourceTempo ?? song.context?.tempo ?? 100),
      patternLength = patternBeats(track, song.context),
      events: PerformanceEvent[] = [];
    for (let cycle = 0; cycle < length; cycle += patternLength)
      for (const e of track.events) {
        const at = cycle + e.time / sourceBeat;
        if (at < length)
          events.push({
            ...e,
            time: at * beat,
            duration: Math.min(e.duration / sourceBeat, length - at) * beat,
          });
      }
    return {
      ...track,
      events,
      duration: length * beat,
      muted: track.muted || (anySolo && !track.solo),
      volume: (track.volume ?? 1) * (song.masterVolume ?? 0.85),
    };
  });
}
export function changeInstrument(
  track: Track,
  instrument: Instrument,
  context: SongContext,
): Track {
  const arrangement = resolveIntent(
    track.intent,
    instrument,
    { ...context, tempo: track.sourceTempo ?? context.tempo },
    track.smoother,
    true,
  );
  return {
    ...track,
    ...arrangement,
    instrument,
    name: track.generated
      ? `${instrument[0].toUpperCase() + instrument.slice(1)} idea`
      : track.name,
    ...(track.generated ? { pinned: true, edited: true } : {}),
  };
}
export function moveSection(song: Song, id: string, direction: -1 | 1): Song {
  const sections = [...(song.sections ?? [])],
    index = sections.findIndex((s) => s.id === id),
    next = index + direction;
  if (index < 0 || next < 0 || next >= sections.length) return song;
  [sections[index], sections[next]] = [sections[next], sections[index]];
  return { ...song, sections };
}
