import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OfflineAudioContext as NativeOfflineAudioContext } from 'node-web-audio-api';
import { Mp3Encoder } from '@breezystack/lamejs';
import { AudioEngine } from '../lib/music/audio';
import { buildIntent } from '../lib/music/analyze';
import { inferContext, resolveIntent } from '../lib/music/resolve';
import { newSong, type Track } from '../lib/music/types';
import { arrangedTracks, composeSong } from '../lib/music/composition';

void test('real samples render non-silent bounded stereo audio and both exports decode', async () => {
  const originalFetch = globalThis.fetch;
  const originalOffline = globalThis.OfflineAudioContext;
  globalThis.OfflineAudioContext =
    NativeOfflineAudioContext as unknown as typeof OfflineAudioContext;
  globalThis.fetch = async (input) => {
    const path =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    assert.ok(path.startsWith('/samples/'));
    const file = await readFile(new URL(`../public${path}`, import.meta.url));
    return new Response(file);
  };
  const decoder = new NativeOfflineAudioContext(2, 44100, 44100);
  const engine = new AudioEngine();
  // The decoder needs no hardware device. Production rendering remains unmodified.
  engine.ready = async () => decoder as unknown as AudioContext;
  try {
    const intent = buildIntent(
      'hum',
      [60, 64, 67].map((pitch, i) => ({
        time: i * 0.5,
        duration: 0.4,
        pitch,
        confidence: 1,
        intensity: 0.8,
      })),
      2,
    );
    const context = inferContext(intent);
    const track: Track = {
      id: 'p',
      instrument: 'piano',
      name: 'Piano',
      intent,
      ...resolveIntent(intent, 'piano', context),
      original: null,
      muted: false,
      smoother: false,
    };
    const song = composeSong({ ...newSong(), context, tracks: [track] });
    const fullSong = arrangedTracks(song);
    const rendered = await engine.render(fullSong);
    assert.ok(rendered.duration > 45, 'Expected a complete multi-section song');
    const lastSection = rendered
      .getChannelData(0)
      .slice(Math.floor((rendered.duration - 4) * 44100));
    assert.ok(
      lastSection.some((value) => Math.abs(value) > 0.01),
      'The ending should contain music',
    );
    const left = rendered.getChannelData(0),
      right = rendered.getChannelData(1);
    let peak = 0,
      power = 0;
    for (const value of left) {
      assert.ok(Number.isFinite(value));
      peak = Math.max(peak, Math.abs(value));
      power += value * value;
    }
    assert.ok(peak > 0.01, `Silent render: peak ${peak}`);
    assert.ok(peak <= 0.971);
    assert.ok(Math.sqrt(power / left.length) > 0.005);
    assert.equal(rendered.numberOfChannels, 2);
    const wav = await engine.exportWav(fullSong);
    const decoded = await decoder.decodeAudioData(await wav.arrayBuffer());
    assert.equal(decoded.numberOfChannels, 2);
    assert.ok(Math.abs(decoded.duration - rendered.duration) < 0.001);
    const encoder = new Mp3Encoder(2, 44100, 192),
      chunks: Uint8Array<ArrayBuffer>[] = [];
    const toPCM = (channel: Float32Array) =>
      Int16Array.from(
        channel,
        (value) => Math.max(-1, Math.min(1, value)) * 32767,
      );
    const l = toPCM(left),
      r = toPCM(right);
    for (let i = 0; i < l.length; i += 1152)
      chunks.push(
        new Uint8Array(
          encoder.encodeBuffer(
            l.subarray(i, i + 1152),
            r.subarray(i, i + 1152),
          ),
        ),
      );
    chunks.push(new Uint8Array(encoder.flush()));
    const mp3 = new Blob(chunks, { type: 'audio/mpeg' });
    const decodedMp3 = await decoder.decodeAudioData(await mp3.arrayBuffer());
    assert.ok(decodedMp3.duration >= rendered.duration);
    assert.equal(decodedMp3.numberOfChannels, 2);
    await assert.rejects(
      engine.render([{ ...track, muted: true }]),
      /turn its sound on/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.OfflineAudioContext = originalOffline;
  }
});

void test('drum-only mix renders without fetching piano samples', async () => {
  const previous = globalThis.OfflineAudioContext;
  globalThis.OfflineAudioContext =
    NativeOfflineAudioContext as unknown as typeof OfflineAudioContext;
  try {
    const engine = new AudioEngine(),
      intent = buildIntent('touch', [], 2);
    const track: Track = {
      id: 'd',
      instrument: 'drums',
      name: 'Drums',
      intent,
      events: [
        { time: 0, note: 36, duration: 0.16, velocity: 0.9 },
        { time: 0.5, note: 38, duration: 0.16, velocity: 0.8 },
        { time: 1, note: 42, duration: 0.1, velocity: 0.6 },
      ],
      duration: 2,
      original: null,
      muted: false,
      smoother: false,
    };
    const buffer = await engine.render([track]);
    for (const at of [0.02, 0.52, 1.02]) {
      const data = buffer
        .getChannelData(0)
        .slice(Math.floor(at * 44100), Math.floor((at + 0.08) * 44100));
      assert.ok(
        data.some((value) => Math.abs(value) > 0.005),
        `Missing drum at ${at}`,
      );
    }
  } finally {
    globalThis.OfflineAudioContext = previous;
  }
});

void test('bass, guitar, strings and synth produce distinct, sustained, pitched voices', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const path =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const file = await readFile(new URL(`../public${path}`, import.meta.url));
    return new Response(file);
  };
  const previous = globalThis.OfflineAudioContext;
  globalThis.OfflineAudioContext =
    NativeOfflineAudioContext as unknown as typeof OfflineAudioContext;
  try {
    const signatures: number[] = [];
    for (const instrument of ['bass', 'guitar', 'strings', 'synth'] as const) {
      const engine = new AudioEngine(),
        intent = buildIntent('hum', [], 2);
      const track: Track = {
        id: instrument,
        instrument,
        name: instrument,
        intent,
        events: [{ time: 0, note: 57, duration: 1.6, velocity: 0.8 }],
        duration: 2,
        original: null,
        muted: false,
        smoother: false,
      };
      const decoder = new NativeOfflineAudioContext(2, 44100, 44100);
      engine.ready = async () => decoder as unknown as AudioContext;
      const buffer = await engine.render([track]);
      const data = buffer.getChannelData(0);
      let energy = 0;
      for (const value of data) {
        assert.ok(Number.isFinite(value));
        energy += value * value;
      }
      assert.ok(energy > 1, `${instrument} is silent`);
      signatures.push(energy);
      if (instrument === 'strings' || instrument === 'synth')
        assert.ok(
          data.slice(44100, 44100 + 4410).some((v) => Math.abs(v) > 0.01),
          `${instrument} failed to sustain`,
        );
    }
    assert.equal(new Set(signatures.map((n) => n.toFixed(2))).size, 4);
  } finally {
    globalThis.OfflineAudioContext = previous;
    globalThis.fetch = originalFetch;
  }
});

void test('seek starts at the requested song clock and repeat retains the full song period', async () => {
  // Scheduling is exercised with the actual native audio graph on an offline context.
  const context = new NativeOfflineAudioContext(2, 44100, 44100);
  const engine = new AudioEngine();
  engine.ready = async () => context as unknown as AudioContext;
  const track: Track = {
    id: 'beat',
    instrument: 'drums',
    name: 'Beat',
    intent: buildIntent('touch', [], 4),
    events: [
      { time: 0, note: 36, duration: 0.1, velocity: 0.8 },
      { time: 2, note: 38, duration: 0.1, velocity: 0.8 },
    ],
    duration: 4,
    original: null,
    muted: false,
    smoother: false,
  };
  try {
    const playback = await engine.play([track], true, () => {}, undefined, 2);
    assert.ok(playback);
    assert.equal(playback.duration, 4);
    assert.ok(Math.abs(playback.startAt - -1.93) < 0.01);
  } finally {
    engine.stop();
  }
});

void test('a held synth note audibly fades in and out in the actual audio render', async () => {
  const previous = globalThis.OfflineAudioContext;
  globalThis.OfflineAudioContext =
    NativeOfflineAudioContext as unknown as typeof OfflineAudioContext;
  try {
    const engine = new AudioEngine();
    const track: Track = {
      id: 'held',
      name: 'Held note',
      instrument: 'synth',
      intent: buildIntent('hum', [], 4),
      events: [{ time: 0, duration: 4, note: 57, velocity: 0.6 }],
      duration: 4,
      original: null,
      muted: false,
      smoother: false,
    };
    const song = {
      ...newSong(),
      context: { tempo: 120, key: 0, mode: 'major' as const, confidence: 1 },
      tracks: [track],
      sections: [
        {
          id: 's',
          name: 'Swell',
          bars: 2,
          energy: 1,
          trackIds: ['held'],
          parts: {
            held: {
              offsetBeats: 0,
              repeat: false,
              transpose: 0,
              fadeInBeats: 4,
              fadeOutBeats: 4,
            },
          },
        },
      ],
    };
    const buffer = await engine.render(arrangedTracks(song));
    const rms = (at: number) => {
      const samples = buffer
        .getChannelData(0)
        .slice(
          Math.floor(at * buffer.sampleRate),
          Math.floor((at + 0.1) * buffer.sampleRate),
        );
      return Math.sqrt(samples.reduce((n, x) => n + x * x, 0) / samples.length);
    };
    assert.ok(
      rms(1.9) > rms(0.25) * 2,
      'Held note must grow between note attacks',
    );
    assert.ok(
      rms(1.9) > rms(3.75) * 2,
      'Held note must fade before its release',
    );
  } finally {
    globalThis.OfflineAudioContext = previous;
  }
});

void test('cleanup reduces the previous note tail in the rendered audio', async () => {
  const previous = globalThis.OfflineAudioContext;
  globalThis.OfflineAudioContext =
    NativeOfflineAudioContext as unknown as typeof OfflineAudioContext;
  try {
    const engine = new AudioEngine();
    const track: Track = {
      id: 'tail',
      name: 'Phrase',
      instrument: 'synth',
      intent: buildIntent('hum', [], 1),
      events: [
        { time: 0, duration: 0.4, note: 57, velocity: 0.7 },
        { time: 0.4, duration: 0.4, note: 64, velocity: 0 },
      ],
      duration: 1,
      muted: false,
      smoother: false,
      original: null,
    };
    const before = await engine.render([track]);
    const after = await engine.render([{ ...track, smoother: true }]);
    const rms = (buffer: AudioBuffer, a: number, b: number) => {
      const data = buffer
        .getChannelData(0)
        .slice(Math.floor(a * 44100), Math.floor(b * 44100));
      return Math.sqrt(data.reduce((s, n) => s + n * n, 0) / data.length);
    };
    assert.ok(
      rms(after, 0.52, 0.59) < rms(before, 0.52, 0.59) * 0.5,
      'Prior pitch should decay substantially before the following note continues',
    );
    assert.ok(
      rms(after, 0.1, 0.3) > rms(before, 0.1, 0.3) * 0.9,
      'Cleanup must retain the body of the note',
    );
  } finally {
    globalThis.OfflineAudioContext = previous;
  }
});
