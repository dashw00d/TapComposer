import { arrangedTracks } from '../music/composition';
import { songDuration } from '../music/resolve';
import type { Song } from '../music/types';
export function songFingerprint(song: Song): string {
  const text = JSON.stringify({
    context: song.context,
    tracks: arrangedTracks(song),
  });
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
