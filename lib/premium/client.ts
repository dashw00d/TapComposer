import { arrangedTracks } from '../music/composition';
import { songDuration } from '../music/resolve';
import type { Song } from '../music/types';
export function songFingerprint(song: Song): string {
  return fingerprint({
    context: song.context,
    tracks: arrangedTracks(song).map(
      ({ instrument, events, duration, muted, volume, pan }) => ({
        instrument,
        events,
        duration,
        muted,
        volume,
        pan,
      }),
    ),
  });
}
/** Existing takes used the full track objects; retain compatibility with those saves. */
export function matchesSong(fingerprintValue: string, song: Song): boolean {
  if (fingerprintValue === songFingerprint(song)) return true;
  return (
    fingerprintValue ===
    fingerprint({
      context: song.context,
      tracks: arrangedTracks(song).map((track) => {
        const previous = { ...track };
        delete previous.pinned;
        delete previous.edited;
        return previous;
      }),
    })
  );
}
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
export function renderMetadata(song: Song, direction = '', strength = 0.8) {
  const parts = [
    ...new Set(
      arrangedTracks(song)
        .filter((t) => !t.muted && t.events.length)
        .map((t) => t.instrument),
    ),
  ];
  return {
    duration: songDuration(arrangedTracks(song)) + 0.7,
    tempo: song.context?.tempo ?? 100,
    key: song.context?.key ?? 0,
    mode: song.context?.mode ?? 'major',
    strength,
    prompt:
      `Instrumental ${song.compose?.feel ?? 'easy'} music featuring ${parts.join(', ')}. A polished, expressive studio performance with a clear melody, supportive harmony, natural dynamics and a balanced mix. Follow the source melody, rhythm and section changes. ${direction.trim()}`.slice(
        0,
        2000,
      ),
  };
}
export interface RenderJob {
  id: string;
  state: 'queued' | 'rendering' | 'ready' | 'failed';
  createdAt: number;
  duration: number;
  error?: string;
}
export async function studioFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch('/api/premium/' + path, init);
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
    };
    throw new Error(
      data.error ??
        data.detail ??
        'The studio is unavailable. Please try again.',
    );
  }
  return response.json() as Promise<T>;
}
