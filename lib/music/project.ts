import type { Song, Track, Instrument, PremiumTake } from './types';
import { INSTRUMENTS } from './instruments';
export async function exportProject(song: Song): Promise<Blob> {
  const tracks = await Promise.all(
    song.tracks.map(async (track) => {
      let original: string | null = null;
      if (track.original) {
        original = await encodeAudio(track.original);
      }
      return { ...track, original };
    }),
  );
  const premiumTakes = await Promise.all(
    (song.premiumTakes ?? []).map(async (take) => ({
      ...take,
      audio: await encodeAudio(take.audio),
    })),
  );
  return new Blob(
    [
      JSON.stringify({
        ...song,
        premiumTakes,
        format: 'tapcomposer-project',
        tracks,
      }),
    ],
    { type: 'application/json' },
  );
}
async function encodeAudio(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function number(value: unknown, min: number, max: number) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}
export async function importProject(file: Blob): Promise<Song> {
  if (file.size > 150 * 1024 * 1024)
    throw new Error(
      'That project is too large. Choose a TapComposer project under 150 MB.',
    );
  const data: unknown = JSON.parse(await file.text());
  if (
    !object(data) ||
    data.format !== 'tapcomposer-project' ||
    data.version !== 1 ||
    typeof data.name !== 'string' ||
    !Array.isArray(data.tracks) ||
    data.tracks.length > 24
  )
    throw new Error('Choose a valid TapComposer project file.');
  const empty = data.tracks.length === 0 && data.context === null;
  if (
    !empty &&
    (!object(data.context) ||
      !number(data.context.tempo, 40, 240) ||
      !number(data.context.key, 0, 11) ||
      !['major', 'minor'].includes(String(data.context.mode)))
  )
    throw new Error('This project has invalid song settings.');
  if (
    object(data.context) &&
    data.context.chords !== undefined &&
    (!Array.isArray(data.context.chords) ||
      data.context.chords.length > 32 ||
      !data.context.chords.every(
        (chord) =>
          Array.isArray(chord) &&
          chord.length >= 3 &&
          chord.length <= 8 &&
          chord.every((note) => number(note, 0, 127)),
      ))
  )
    throw new Error('This project contains invalid harmony.');
  const tracks: Track[] = data.tracks.map((raw) => {
    if (
      !object(raw) ||
      typeof raw.id !== 'string' ||
      typeof raw.name !== 'string' ||
      !INSTRUMENTS.some((i) => i.id === raw.instrument) ||
      !number(raw.duration, 0, 120) ||
      !Array.isArray(raw.events) ||
      raw.events.length > 10000 ||
      (raw.sourceTempo !== undefined && !number(raw.sourceTempo, 40, 240)) ||
      !object(raw.intent) ||
      (raw.intent.vocalStyle !== undefined &&
        (typeof raw.intent.vocalStyle !== 'string' ||
          !['hmm', 'daa', 'baa'].includes(raw.intent.vocalStyle))) ||
      !Array.isArray(raw.intent.events) ||
      raw.intent.events.length > 10000 ||
      !['hum', 'touch', 'microphone-taps'].includes(
        String(raw.intent.source),
      ) ||
      !number(raw.intent.duration, 0, 120) ||
      !number(raw.intent.confidence, 0, 1)
    )
      throw new Error('This project contains an invalid part.');
    for (const event of raw.events) {
      if (
        !object(event) ||
        !number(event.time, 0, 120) ||
        !number(event.duration, 0.001, 120) ||
        !number(event.note, 0, 127) ||
        !number(event.velocity, 0, 1)
      )
        throw new Error('This project contains invalid music events.');
      if (
        event.expression !== undefined &&
        (!Array.isArray(event.expression) ||
          event.expression.length > 16 ||
          !event.expression.every(
            (p, i, points) =>
              object(p) &&
              number(p.time, 0, 120) &&
              number(p.gain, 0, 1) &&
              (i === 0 || (p.time as number) > points[i - 1].time),
          ))
      )
        throw new Error('This project contains invalid expression.');
    }
    for (const event of raw.intent.events) {
      if (
        !object(event) ||
        !number(event.time, 0, 120) ||
        !number(event.duration, 0, 120) ||
        (event.pitch !== null && !number(event.pitch, 0, 127)) ||
        !number(event.confidence, 0, 1) ||
        (event.pitchDrift !== undefined &&
          typeof event.pitchDrift !== 'boolean') ||
        !number(event.intensity, 0, 1)
      )
        throw new Error('This project contains invalid source events.');
    }
    let original: Blob | null = null;
    if (typeof raw.original === 'string') {
      const binary = atob(raw.original);
      original = new Blob([Uint8Array.from(binary, (c) => c.charCodeAt(0))], {
        type: 'audio/wav',
      });
    }
    return {
      ...raw,
      instrument: raw.instrument as Instrument,
      original,
      volume: number(raw.volume, 0, 1.5) ? raw.volume : 1,
      pan: number(raw.pan, -1, 1) ? raw.pan : 0,
      solo: raw.solo === true,
      muted: raw.muted === true,
      generated: raw.generated === true,
      pinned: raw.pinned === true,
      edited: raw.edited === true,
    } as unknown as Track;
  });
  if (new Set(tracks.map((t) => t.id)).size !== tracks.length)
    throw new Error('This project has duplicate parts.');
  if (data.clips !== undefined) {
    if (
      !Array.isArray(data.clips) ||
      data.clips.length > 576 ||
      !data.clips.every(
        (clip) =>
          object(clip) &&
          typeof clip.id === 'string' &&
          tracks.some((t) => t.id === clip.trackId) &&
          number(clip.startBeat, 0, 511.75) &&
          number(clip.lengthBeats, 0.25, 512) &&
          (clip.startBeat as number) + (clip.lengthBeats as number) <= 512 &&
          typeof clip.repeat === 'boolean' &&
          number(clip.transpose, -24, 24) &&
          (clip.fadeInBeats === undefined ||
            number(clip.fadeInBeats, 0, 128)) &&
          (clip.fadeOutBeats === undefined ||
            number(clip.fadeOutBeats, 0, 128)),
      )
    )
      throw new Error('This project contains invalid timeline blocks.');
    if (new Set(data.clips.map((clip) => clip.id)).size !== data.clips.length)
      throw new Error('This project contains duplicate timeline blocks.');
  }
  const sections = Array.isArray(data.sections) ? data.sections : [];
  if (sections.length > 12)
    throw new Error('This project has too many sections.');
  for (const section of sections) {
    if (
      !object(section) ||
      typeof section.id !== 'string' ||
      typeof section.name !== 'string' ||
      !number(section.bars, 1, 32) ||
      !number(section.energy, 0, 1) ||
      !Array.isArray(section.trackIds) ||
      !section.trackIds.every((id) => tracks.some((t) => t.id === id))
    )
      throw new Error('This project has an invalid arrangement.');
  }
  if (new Set(sections.map((section) => section.id)).size !== sections.length)
    throw new Error('This project has duplicate sections.');
  if (
    sections.reduce(
      (sum, section) => sum + (section as { bars: number }).bars * 4,
      0,
    ) > 512
  )
    throw new Error('This song is too long to open safely.');
  for (const section of sections) {
    if (section.pinned !== undefined) section.pinned = section.pinned === true;
    if (section.parts !== undefined) {
      if (
        !object(section.parts) ||
        !Object.values(section.parts).every(
          (setting) =>
            object(setting) &&
            number(setting.offsetBeats, 0, 127) &&
            typeof setting.repeat === 'boolean' &&
            number(setting.transpose, -24, 24) &&
            (setting.fadeInBeats === undefined ||
              number(setting.fadeInBeats, 0, 128)) &&
            (setting.fadeOutBeats === undefined ||
              number(setting.fadeOutBeats, 0, 128)),
        )
      )
        throw new Error('This project has invalid part timing.');
    }
  }
  if (
    data.compose !== undefined &&
    (!object(data.compose) ||
      !['easy', 'bright', 'dreamy', 'driving'].includes(
        String(data.compose.feel),
      ) ||
      !number(data.compose.energy, 0.2, 1) ||
      !number(data.compose.variation, 0, 1000000))
  )
    throw new Error('This project has invalid composition settings.');
  if (
    data.premiumTakes !== undefined &&
    (!Array.isArray(data.premiumTakes) || data.premiumTakes.length > 3)
  )
    throw new Error('This project has invalid studio takes.');
  const premiumTakes: PremiumTake[] = (
    (data.premiumTakes as unknown[]) ?? []
  ).map((raw) => {
    if (
      !object(raw) ||
      typeof raw.id !== 'string' ||
      typeof raw.fingerprint !== 'string' ||
      !number(raw.createdAt, 0, 1e15) ||
      !number(raw.duration, 10, 181) ||
      typeof raw.audio !== 'string' ||
      raw.audio.length > 48 * 1024 * 1024
    )
      throw new Error('This project has an invalid studio take.');
    const bytes = Uint8Array.from(atob(raw.audio), (c) => c.charCodeAt(0));
    if (
      String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...bytes.slice(8, 12)) !== 'WAVE'
    )
      throw new Error('This studio take is not a WAV recording.');
    return {
      id: raw.id,
      fingerprint: raw.fingerprint,
      createdAt: raw.createdAt as number,
      duration: raw.duration as number,
      audio: new Blob([bytes], { type: 'audio/wav' }),
    };
  });
  const parsed = data as unknown as Song;
  return {
    ...parsed,
    id: crypto.randomUUID(),
    name: data.name.slice(0, 60),
    tracks,
    premiumTakes,
    harmonyPinned: parsed.harmonyPinned === true,
    familyId:
      typeof parsed.familyId === 'string'
        ? parsed.familyId.slice(0, 100)
        : undefined,
    branchedFrom:
      typeof parsed.branchedFrom === 'string'
        ? parsed.branchedFrom.slice(0, 100)
        : undefined,
    repeat: parsed.repeat === true,
    masterVolume: number(parsed.masterVolume, 0, 1)
      ? parsed.masterVolume
      : 0.85,
    updatedAt: Date.now(),
  };
}
