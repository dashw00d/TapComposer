import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { OfflineAudioContext as NativeOffline } from 'node-web-audio-api';
import { AudioEngine } from '../lib/music/audio';
import { makeDemoSong } from '../lib/music/demo';
import { arrangedTracks } from '../lib/music/composition';
import { renderMetadata } from '../lib/premium/client';
globalThis.OfflineAudioContext =
  NativeOffline as unknown as typeof OfflineAudioContext;
globalThis.fetch = async (input) =>
  new Response(
    await readFile(
      'public' +
        (typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url),
    ),
  );
const decoder = new NativeOffline(2, 44100, 44100);
const engine = new AudioEngine();
engine.ready = async () => decoder as unknown as AudioContext;
const song = makeDemoSong();
const blob = await engine.exportWav(arrangedTracks(song));
await mkdir('outputs', { recursive: true });
await writeFile(
  'outputs/demo-source.wav',
  new Uint8Array(await blob.arrayBuffer()),
);
await writeFile(
  'outputs/demo-metadata.json',
  JSON.stringify(
    renderMetadata(
      song,
      'Warm acoustic piano and strings, expressive live drums, mellow bass. Elegant indie instrumental, spacious and emotional.',
    ),
  ),
);
console.log('Demo source prepared:', blob.size, 'bytes');
