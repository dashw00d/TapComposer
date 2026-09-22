import { buildIntent } from './analyze';
import { inferContext, resolveIntent } from './resolve';
import { composeSong } from './composition';
import { newSong, type Song, type Track } from './types';
export function makeDemoSong(song: Song = newSong()): Song {
  const intent = buildIntent(
    'hum',
    [60, 64, 67, 64, 62, 60].map((pitch, i) => ({
      pitch,
      time: i * 0.48,
      duration: i === 5 ? 0.85 : 0.36,
      confidence: 1,
      intensity: i === 0 ? 0.85 : 0.65,
    })),
    4.8,
  );
  const context = inferContext(intent);
  const piano: Track = {
    id: crypto.randomUUID(),
    instrument: 'piano',
    name: 'Piano example',
    intent,
    ...resolveIntent(intent, 'piano', context),
    original: null,
    muted: false,
    smoother: false,
  };
  const taps = buildIntent(
    'touch',
    Array.from({ length: 8 }, (_, i) => ({
      pitch: null,
      time: i * 0.48,
      duration: 0.1,
      confidence: 1,
      intensity: i % 2 === 0 ? 0.9 : 0.6,
    })),
    4.8,
  );
  const drums: Track = {
    id: crypto.randomUUID(),
    instrument: 'drums',
    name: 'Drums example',
    intent: taps,
    ...resolveIntent(taps, 'drums', context),
    original: null,
    muted: false,
    smoother: false,
  };
  const composed = composeSong({ ...song, context, tracks: [piano, drums] });
  // The bundled Studio Take was rendered from this specific 28-bar example.
  // Keep that source arrangement stable as new user songs get shorter defaults.
  return composeSong({
    ...composed,
    tracks: composed.tracks.map((track) =>
      track.generated
        ? {
            ...track,
            duration: (16 * 60) / context.tempo,
          }
        : track,
    ),
    sections: composed.sections!.map((section, i) => ({
      ...section,
      bars: [4, 8, 4, 8, 4][i],
    })),
  });
}
