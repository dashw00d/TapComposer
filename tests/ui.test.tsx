import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { newSong, type Song, type Track } from '../lib/music/types';
import { composeSong } from '../lib/music/composition';
import { buildIntent } from '../lib/music/analyze';
import { inferContext, resolveIntent } from '../lib/music/resolve';
import { AudioEngine } from '../lib/music/audio';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost:3000',
});
Object.defineProperty(globalThis, 'window', {
  value: dom.window,
  configurable: true,
});
Object.defineProperty(globalThis, 'document', {
  value: dom.window.document,
  configurable: true,
});
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
});
for (const key of [
  'HTMLElement',
  'Element',
  'Node',
  'DocumentFragment',
  'MutationObserver',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'HTMLInputElement',
  'HTMLButtonElement',
] as const)
  Object.defineProperty(globalThis, key, {
    value: dom.window[key],
    configurable: true,
  });
Object.defineProperty(globalThis, 'getComputedStyle', {
  value: dom.window.getComputedStyle.bind(dom.window),
  configurable: true,
});
Object.defineProperty(globalThis, 'requestAnimationFrame', {
  value: (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0),
  configurable: true,
});
Object.defineProperty(globalThis, 'cancelAnimationFrame', {
  value: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  configurable: true,
});
Object.defineProperty(window, 'matchMedia', {
  value: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }),
  configurable: true,
});
Object.defineProperty(globalThis, 'ResizeObserver', {
  value: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  configurable: true,
});
const { render, screen, fireEvent, waitFor, cleanup } =
  await import('@testing-library/react');
const { CompositionPanel } = await import('../components/composition-panel');
const { Recorder } = await import('../components/recorder');
function sample() {
  const intent = buildIntent(
      'hum',
      [60, 64, 67].map((pitch, i) => ({
        pitch,
        time: i * 0.5,
        duration: 0.4,
        intensity: 0.7,
        confidence: 1,
      })),
      2,
    ),
    context = inferContext(intent);
  const track: Track = {
    id: 'idea',
    name: 'My melody',
    instrument: 'piano',
    intent,
    ...resolveIntent(intent, 'piano', context),
    original: null,
    muted: false,
    smoother: false,
    sourceTempo: context.tempo,
  };
  return composeSong({ ...newSong(), context, tracks: [track] });
}
void test('arrangement controls change audible section membership, order and length', async () => {
  let song = sample();
  const update = (change: (song: Song) => Song) => {
    song = change(song);
    view.rerender(
      <CompositionPanel
        song={song}
        update={update}
        onSeek={() => {}}
        position={0}
      />,
    );
  };
  const view = render(
    <CompositionPanel
      song={song}
      update={update}
      onSeek={() => {}}
      position={0}
    />,
  );
  const original = song.sections![0].bars;
  fireEvent.click(screen.getByRole('button', { name: 'Lengthen A way in' }));
  assert.equal(song.sections![0].bars, original + 2);
  fireEvent.click(
    screen.getByRole('button', { name: 'Move Find the groove earlier' }),
  );
  assert.equal(song.sections![0].name, 'Find the groove');
  const id = song.tracks[0].id;
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Remove My melody from Find the groove',
    }),
  );
  assert.ok(!song.sections![0].trackIds.includes(id));
  fireEvent.click(
    screen.getByRole('button', { name: 'Add My melody to Find the groove' }),
  );
  assert.ok(song.sections![0].trackIds.includes(id));
  fireEvent.click(screen.getByRole('button', { name: 'Try another version' }));
  assert.equal(song.compose!.variation, 1);
  assert.equal(song.sections![0].name, 'Find the groove');
  fireEvent.click(
    screen.getByRole('button', { name: 'Shape Find the groove' }),
  );
  await waitFor(() => assert.ok(screen.getByRole('dialog')));
  const nameInput = screen.getByLabelText('Section name');
  fireEvent.change(nameInput, { target: { value: 'My chorus' } });
  fireEvent.blur(nameInput);
  assert.equal(song.sections![0].name, 'My chorus');
  fireEvent.click(screen.getAllByRole('switch')[0]);
  assert.equal(song.sections![0].parts?.[id].repeat, false);
  cleanup();
});
void test('tap input can audition layered piano and strings while keeping the original idea', async () => {
  const engine = new AudioEngine();
  engine.ready = async () => ({}) as AudioContext;
  engine.tap = async () => {};
  engine.stop = () => {};
  engine.play = async () => ({ startAt: 0, duration: 4 });
  engine.load = async () => {};
  let kept: Track | null = null;
  let layers: Track[] = [];
  const song = newSong();
  const now = performance.now.bind(performance);
  let clock = 10000;
  Object.defineProperty(performance, 'now', {
    value: () => clock,
    configurable: true,
  });
  try {
    render(
      <Recorder
        instrument="piano"
        song={song}
        engine={engine}
        onClose={() => {}}
        onKeep={(track) => {
          kept = track;
        }}
        onKeepLayers={(tracks) => {
          layers = tracks;
          kept = tracks[0];
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tap pad' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tap rhythm pad' }));
    await waitFor(() => assert.ok(screen.getByText('1 tap')));
    for (let i = 0; i < 3; i++) {
      clock += 500;
      fireEvent.click(screen.getByRole('button', { name: 'Tap rhythm pad' }));
    }
    clock += 500;
    fireEvent.click(screen.getByRole('button', { name: 'Hear my idea' }));
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Keep it' })),
    );
    fireEvent.click(screen.getByText('Layer sounds or hear it with the song'));
    fireEvent.click(
      screen.getByRole('switch', { name: 'Use more than one instrument' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Strings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    assert.equal(layers.length, 2);
    assert.equal(layers[1].instrument, 'strings');
    assert.equal(layers[0].intent, layers[1].intent);
    assert.ok(kept);
    const track = kept as Track;
    assert.equal(track.instrument, 'piano');
    assert.equal(track.intent.source, 'touch');
    assert.equal(track.intent.events.length, 4);
    assert.ok(track.events.length >= 12);
  } finally {
    Object.defineProperty(performance, 'now', {
      value: now,
      configurable: true,
    });
    cleanup();
  }
});

void test('premium renders the arrangement, collects its take, and free mode makes no uploads', async () => {
  const { PremiumStudio } = await import('../components/premium-studio');
  Object.defineProperty(globalThis, 'localStorage', {
    value: dom.window.localStorage,
    configurable: true,
  });
  localStorage.clear();
  const oldFetch = globalThis.fetch;
  const calls: string[] = [];
  const id = '12345678-1234-1234-1234-123456789abc';
  const job = { id, state: 'queued', createdAt: Date.now(), duration: 55 };
  globalThis.fetch = async (input, init) => {
    const path =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push(path);
    if (path.endsWith('/status'))
      return Response.json({ premium: true, ready: true });
    if (path.endsWith('/render')) {
      assert.ok(init?.body instanceof Blob);
      assert.ok(new Headers(init.headers).get('X-TapComposer-Arrangement'));
      return Response.json(job);
    }
    if (path.endsWith('/audio'))
      return new Response(
        new Blob(['RIFF0000WAVEaudio'], { type: 'audio/wav' }),
      );
    return Response.json({ ...job, state: 'ready' });
  };
  const engine = new AudioEngine();
  engine.exportWav = async () =>
    new Blob(['arranged audio'], { type: 'audio/wav' });
  const song = sample();
  let kept = 0;
  try {
    render(
      <PremiumStudio
        song={song}
        engine={engine}
        onKeep={() => {
          kept++;
        }}
        onBeforePlay={() => {}}
        originalPlaying={false}
      />,
    );
    await waitFor(() =>
      assert.equal(
        (
          screen.getByRole('button', {
            name: 'Make a studio take',
          }) as HTMLButtonElement
        ).disabled,
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Make a studio take' }));
    await waitFor(() => assert.equal(kept, 1));
    assert.equal(calls.filter((path) => path.endsWith('/render')).length, 1);
    cleanup();
    calls.length = 0;
    localStorage.setItem('tapcomposer-service', 'free');
    render(
      <PremiumStudio
        song={song}
        engine={engine}
        onKeep={() => {}}
        onBeforePlay={() => {}}
        originalPlaying={false}
      />,
    );
    await waitFor(() =>
      assert.ok(screen.getByText('Your studio. On your device.')),
    );
    assert.equal(
      screen.queryByRole('button', { name: 'Make a studio take' }),
      null,
    );
    assert.equal(calls.filter((path) => path.endsWith('/render')).length, 0);
  } finally {
    cleanup();
    globalThis.fetch = oldFetch;
    localStorage.clear();
  }
});

void test('comparison keeps the listening moment even across rapid switches', async () => {
  const { AudioComparison } = await import('../components/audio-comparison');
  const engine = new AudioEngine();
  engine.render = async () =>
    ({
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array([0.1, -0.1]),
    }) as unknown as AudioBuffer;
  let beforePlay = 0;
  try {
    const view = render(
      <AudioComparison
        sources={[
          { id: 'a', label: 'Before', song: sample() },
          { id: 'b', label: 'Proposed', song: sample() },
        ]}
        engine={engine}
        onBeforePlay={() => {
          beforePlay++;
        }}
      />,
    );
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Proposed' })),
    );
    const audio = view.container.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { value: 20, configurable: true });
    Object.defineProperty(audio, 'paused', {
      value: false,
      configurable: true,
    });
    let resumed = 0;
    audio.play = async () => {
      resumed++;
    };
    audio.currentTime = 12;
    fireEvent.click(screen.getByRole('button', { name: 'Proposed' }));
    // Loading a different source resets media time before metadata arrives.
    audio.currentTime = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Before' }));
    fireEvent.loadedMetadata(audio);
    assert.equal(audio.currentTime, 12);
    assert.equal(resumed, 1);
    fireEvent.play(audio);
    assert.equal(beforePlay, 1);
  } finally {
    cleanup();
  }
});

void test('suggestions can be discarded, retried, accepted once, and undone in the composer', async () => {
  const { indexedDB } = await import('fake-indexeddb');
  Object.defineProperty(globalThis, 'indexedDB', {
    value: indexedDB,
    configurable: true,
  });
  const { saveSong, listSongs } = await import('../lib/music/storage');
  // Match Vinext's production alias when loading the complete app outside Vite.
  const aliases = registerHooks({
    resolve(specifier, context, next) {
      return next(
        specifier === 'next/link' ? 'vinext/shims/link' : specifier,
        context,
      );
    },
  });
  const { default: Composer } = await import('../components/composer');
  aliases.deregister();
  const song = sample();
  await saveSong(song);
  localStorage.setItem('tapcomposer-service', 'free');
  // Store the method for restoration, without invoking it unbound.
  // oxlint-disable-next-line typescript/unbound-method
  const renderAudio = AudioEngine.prototype.render;
  AudioEngine.prototype.render = async () =>
    ({
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array([0.1, -0.1]),
    }) as unknown as AudioBuffer;
  try {
    render(<Composer />);
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Try another version' })),
    );
    assert.ok(
      screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled'),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Try another version' }),
    );
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Proposed' })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    assert.ok(
      screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled'),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Try another version' }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Try another$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep this change' }));
    await waitFor(async () =>
      assert.equal(
        (await listSongs()).find((s) => s.id === song.id)!.compose!.variation,
        2,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () =>
      assert.equal(
        (await listSongs()).find((s) => s.id === song.id)!.compose!.variation,
        0,
      ),
    );
    assert.ok(
      screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled'),
      'One accepted proposal should create one undo step',
    );
  } finally {
    cleanup();
    AudioEngine.prototype.render = renderAudio;
    localStorage.clear();
  }
});
