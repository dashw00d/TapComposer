import { arrangedTracks } from './composition';
import type { Song, Instrument } from './types';
const programs: Record<Instrument, number> = {
  piano: 0,
  drums: 0,
  bass: 33,
  guitar: 24,
  strings: 48,
  synth: 80,
};
const variable = (value: number) => {
  const bytes = [value & 127];
  while ((value >>= 7) > 0) bytes.unshift((value & 127) | 128);
  return bytes;
};
const u32 = (n: number) => [
  (n >>> 24) & 255,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
export function exportMidi(song: Song): Blob {
  const ticks = 480,
    tempo = song.context?.tempo ?? 100,
    beat = 60 / tempo,
    microseconds = Math.round(60000000 / tempo);
  const conductor = [
    0,
    255,
    81,
    3,
    (microseconds >>> 16) & 255,
    (microseconds >>> 8) & 255,
    microseconds & 255,
    0,
    255,
    47,
    0,
  ];
  const chunks = [...ascii('MTrk'), ...u32(conductor.length), ...conductor];
  const tracks = arrangedTracks(song).filter((t) => !t.muted);
  tracks.forEach((track, index) => {
    const channel =
      track.instrument === 'drums'
        ? 9
        : index % 15 >= 9
          ? (index % 15) + 1
          : index % 15;
    const events: { at: number; bytes: number[] }[] = [
      { at: 0, bytes: [255, 33, 1, Math.floor(index / 15)] },
      { at: 0, bytes: [192 + channel, programs[track.instrument]] },
      {
        at: 0,
        bytes: [176 + channel, 10, Math.round(((track.pan ?? 0) + 1) * 63.5)],
      },
    ];
    for (const e of track.events) {
      const at = Math.round((e.time / beat) * ticks);
      events.push(
        {
          at,
          bytes: [
            144 + channel,
            Math.round(e.note),
            Math.max(
              1,
              Math.min(127, Math.round(e.velocity * (track.volume ?? 1) * 127)),
            ),
          ],
        },
        {
          at: at + Math.max(1, Math.round((e.duration / beat) * ticks)),
          bytes: [128 + channel, Math.round(e.note), 0],
        },
      );
    }
    events.sort((a, b) => a.at - b.at || a.bytes[0] - b.bytes[0]);
    let previous = 0;
    const bytes: number[] = [];
    for (const event of events) {
      bytes.push(...variable(event.at - previous), ...event.bytes);
      previous = event.at;
    }
    bytes.push(0, 255, 47, 0);
    chunks.push(...ascii('MTrk'), ...u32(bytes.length));
    for (const byte of bytes) chunks.push(byte);
  });
  return new Blob(
    [
      new Uint8Array([
        ...ascii('MThd'),
        0,
        0,
        0,
        6,
        0,
        1,
        0,
        tracks.length + 1,
        1,
        224,
        ...chunks,
      ]),
    ],
    { type: 'audio/midi' },
  );
}
