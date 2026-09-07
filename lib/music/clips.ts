import type { ArrangementClip, Song } from './types';
export function songClips(song: Song): ArrangementClip[] {
  if (song.clips) return song.clips;
  if (!song.sections?.length)
    return song.tracks
      .filter((t) => t.duration > 0)
      .map((track) => ({
        id: `ideas:${track.id}`,
        trackId: track.id,
        startBeat: 0,
        lengthBeats: Math.max(
          0.25,
          track.duration /
            (60 / (track.sourceTempo ?? song.context?.tempo ?? 100)),
        ),
        repeat: false,
        transpose: 0,
      }));
  let start = 0;
  return song.sections.flatMap((section) => {
    const clips = section.trackIds.map((trackId) => {
      const part = section.parts?.[trackId];
      return {
        id: `${section.id}:${trackId}`,
        trackId,
        startBeat: start + (part?.offsetBeats ?? 0),
        lengthBeats: Math.max(
          0.25,
          section.bars * 4 - (part?.offsetBeats ?? 0),
        ),
        repeat: part?.repeat ?? true,
        transpose: part?.transpose ?? 0,
        ...(part?.fadeInBeats !== undefined
          ? { fadeInBeats: part.fadeInBeats }
          : {}),
        ...(part?.fadeOutBeats !== undefined
          ? { fadeOutBeats: part.fadeOutBeats }
          : {}),
      };
    });
    start += section.bars * 4;
    return clips;
  });
}
export function moveClip(
  song: Song,
  id: string,
  startBeat: number,
  lengthBeats?: number,
): Song {
  return {
    ...song,
    clips: songClips(song).map((clip) => {
      if (clip.id !== id) return clip;
      const length = Math.max(
        0.25,
        Math.min(512, lengthBeats ?? clip.lengthBeats),
      );
      return {
        ...clip,
        startBeat: Math.max(
          0,
          Math.min(512 - length, Math.round(startBeat * 4) / 4),
        ),
        lengthBeats: length,
      };
    }),
  };
}
export function removeClip(song: Song, id: string): Song {
  return { ...song, clips: songClips(song).filter((c) => c.id !== id) };
}
export function copyClip(song: Song, id: string): Song {
  const clips = songClips(song),
    clip = clips.find((c) => c.id === id);
  if (
    !clip ||
    clips.length >= 576 ||
    clip.startBeat + clip.lengthBeats * 2 > 512
  )
    return song;
  return {
    ...song,
    clips: [
      ...clips,
      {
        ...clip,
        id: crypto.randomUUID(),
        startBeat: clip.startBeat + clip.lengthBeats,
      },
    ],
  };
}

export function addClip(song: Song, trackId: string, startBeat: number): Song {
  const clips = songClips(song);
  const track = song.tracks.find((t) => t.id === trackId);
  if (!track || clips.length >= 576) return song;
  const lengthBeats = Math.min(
    512,
    Math.max(
      4,
      Math.ceil(
        track.duration /
          (60 / (track.sourceTempo ?? song.context?.tempo ?? 100)) /
          4,
      ) * 4,
    ),
  );
  return {
    ...song,
    clips: [
      ...clips,
      {
        id: crypto.randomUUID(),
        trackId,
        startBeat: Math.max(
          0,
          Math.min(512 - lengthBeats, Math.round(startBeat * 4) / 4),
        ),
        lengthBeats,
        repeat: true,
        transpose: 0,
      },
    ],
  };
}
