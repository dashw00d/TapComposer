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
  fireEvent.click(screen.getByText('Song settings'));
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

void test('microphone countdown follows the capture clock, shares backing start, and can be cancelled', async () => {
  const oldMedia = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  const oldWorklet = globalThis.AudioWorkletNode;
  let stopped = 0;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => ({
        getTracks: () => [
          {
            stop: () => {
              stopped++;
            },
          },
        ],
      }),
    },
  });
  const nodes: { startAt: number; commands: string[] }[] = [];
  class FakeWorklet {
    record: { startAt: number; commands: string[] };
    port = {
      onmessage: null,
      postMessage: (command: string) => this.record.commands.push(command),
      close() {},
    };
    constructor(
      _context: unknown,
      _name: string,
      options: { processorOptions: { startAt: number } },
    ) {
      this.record = { startAt: options.processorOptions.startAt, commands: [] };
      nodes.push(this.record);
    }
    connect() {}
    disconnect() {}
  }
  globalThis.AudioWorkletNode =
    FakeWorklet as unknown as typeof AudioWorkletNode;
  const clock = {
    currentTime: 10,
    sampleRate: 48000,
    destination: {},
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
  };
  const engine = new AudioEngine();
  engine.prepareCapture = async () => clock as unknown as AudioContext;
  engine.load = async () => {};
  engine.stop = () => {};
  let backingStart: number | undefined;
  engine.play = async (_tracks, _repeat, _end, startAt) => {
    backingStart = startAt;
    return { startAt: startAt!, duration: 4 };
  };
  try {
    render(
      <Recorder
        instrument="piano"
        song={sample()}
        engine={engine}
        onClose={() => {}}
        onKeep={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    await waitFor(() =>
      assert.equal(screen.getByLabelText('Recording cue').textContent, '3'),
    );
    assert.equal(backingStart, nodes[0].startAt);
    assert.ok(nodes[0].startAt - clock.currentTime >= 3);
    assert.equal(
      screen.queryByRole('button', { name: 'Stop recording' }),
      null,
    );
    clock.currentTime = nodes[0].startAt - 1.8;
    await waitFor(() =>
      assert.equal(screen.getByLabelText('Recording cue').textContent, '2'),
    );
    clock.currentTime = nodes[0].startAt - 0.8;
    await waitFor(() =>
      assert.equal(screen.getByLabelText('Recording cue').textContent, '1'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel countdown' }));
    assert.equal(stopped, 1);
    assert.deepEqual(
      nodes[0].commands,
      [],
      'Cancelling must not finish or analyze a take',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    await waitFor(() => assert.equal(nodes.length, 2));
    clock.currentTime = nodes[1].startAt;
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Stop recording' })),
    );
    assert.equal(
      screen.getByLabelText('Recording cue').textContent,
      'Start · hum now',
    );
    fireEvent.blur(screen.getByRole('button', { name: 'Stop recording' }));
    assert.deepEqual(
      nodes[1].commands,
      [],
      'Focus changes no longer stop recording',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    assert.deepEqual(nodes[1].commands, ['stop']);
  } finally {
    cleanup();
    globalThis.AudioWorkletNode = oldWorklet;
    if (oldMedia) Object.defineProperty(navigator, 'mediaDevices', oldMedia);
    else Reflect.deleteProperty(navigator, 'mediaDevices');
  }
});

void test('playlist gestures move and resize audible blocks, while piano-roll edits keep source notes and undo together', async () => {
  const { SongTimeline } = await import('../components/song-timeline');
  const { arrangedTracks } = await import('../lib/music/composition');
  const { songClips } = await import('../lib/music/clips');
  const original = sample();
  let song = original;
  const past: Song[] = [];
  const auditions: { note: number; time: number }[] = [];
  let rerecordId: string | null = null;
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: window.MouseEvent,
  });
  const capture = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'setPointerCapture',
  );
  const release = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'releasePointerCapture',
  );
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  const update = (change: (song: Song) => Song) => {
    past.push(song);
    song = change(song);
    view.rerender(ui());
  };
  const ui = () => (
    <SongTimeline
      song={song}
      update={update}
      onPlay={() => {}}
      onAudition={(track, index) => auditions.push(track.events[index])}
      playing={null}
      position={0}
      onSeek={() => {}}
      onMore={() => {}}
      onRerecord={(track) => { rerecordId = track.id; }}
      onUndo={() => {
        song = past.pop()!;
        view.rerender(ui());
      }}
      canUndo={past.length > 0}
    />
  );
  const view = render(ui());
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Record My melody again' }));
    assert.equal(rerecordId, song.tracks[0].id);
    const clip = screen.getByRole('button', {
      name: 'My melody, bar 1, 1 bars',
    });
    clip.getBoundingClientRect = () => ({
      left: 0,
      right: 190,
      top: 0,
      bottom: 57,
      width: 190,
      height: 57,
      x: 0,
      y: 0,
      toJSON() {},
    });
    fireEvent.pointerDown(clip, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(clip, { clientX: 68, clientY: 20 });
    fireEvent.pointerUp(clip, { clientX: 68, clientY: 20 });
    assert.equal(songClips(song)[0].startBeat, 4);
    assert.equal(past.length, 1, 'a drag creates one undo entry');
    assert.equal(
      arrangedTracks(song)[0].events[0].time,
      (4 * 60) / song.context!.tempo,
    );
    const moved = screen.getByRole('button', {
      name: 'My melody, bar 2, 1 bars',
    });
    fireEvent.pointerDown(moved, { button: 0, clientX: 186, clientY: 20 });
    fireEvent.pointerMove(moved, { clientX: 234, clientY: 20 });
    fireEvent.pointerUp(moved, { clientX: 234, clientY: 20 });
    assert.equal(songClips(song)[0].lengthBeats, 8);
    const note = screen.getByRole('button', { name: /^Note 1,/ });
    note.getBoundingClientRect = () => ({
      left: 0,
      right: 70,
      top: 0,
      bottom: 16,
      width: 70,
      height: 16,
      x: 0,
      y: 0,
      toJSON() {},
    });
    fireEvent.pointerDown(note, { button: 0, clientX: 10, clientY: 40 });
    fireEvent.pointerMove(note, { clientX: 28, clientY: 22 });
    fireEvent.pointerUp(note, { clientX: 28, clientY: 22 });
    assert.equal(
      song.tracks[0].events[0].note,
      original.tracks[0].events[0].note + 2,
    );
    assert.equal(
      song.tracks[0].events[0].time,
      (0.25 * 60) / song.context!.tempo,
    );
    assert.equal(auditions.at(-1)!.note, song.tracks[0].events[0].note);
    assert.equal(song.tracks[0].intent, original.tracks[0].intent);
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    assert.equal(
      song.tracks[0].events.length,
      original.tracks[0].events.length - 1,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    assert.equal(
      song.tracks[0].events.length,
      original.tracks[0].events.length,
    );
    const editedNotes = song.tracks[0].events;
    fireEvent.click(screen.getByRole('button', { name: 'Strings' }));
    assert.equal(song.tracks[0].instrument, 'strings');
    assert.deepEqual(song.tracks[0].events, editedNotes);
    fireEvent.click(screen.getByRole('button', { name: 'Delete block' }));
    assert.equal(song.clips!.length, songClips(original).length - 1);
    assert.equal(song.tracks[0].intent, original.tracks[0].intent);
  } finally {
    cleanup();
    if (capture)
      Object.defineProperty(
        HTMLElement.prototype,
        'setPointerCapture',
        capture,
      );
    else Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
    if (release)
      Object.defineProperty(
        HTMLElement.prototype,
        'releasePointerCapture',
        release,
      );
    else Reflect.deleteProperty(HTMLElement.prototype, 'releasePointerCapture');
  }
});

void test('mixer sliders have clear live values and Hear alone selects exactly one audible part', async () => {
  const { MixControls } = await import('../components/composition-panel');
  const { arrangedTracks } = await import('../lib/music/composition');
  let song = sample();
  song.tracks[0].muted = true;
  let edits = 0;
  const update = (change: (song: Song) => Song) => {
    song = change(song);
    edits++;
    view.rerender(<MixControls song={song} update={update} />);
  };
  const view = render(<MixControls song={song} update={update} />);
  try {
    // jsdom has no layout; Base UI keeps its unmeasured thumb visually hidden.
    const slider = screen.getByLabelText('My melody volume', {
      selector: 'input',
    });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    assert.equal(song.tracks[0].volume, 1.05);
    assert.ok(edits <= 1);
    assert.ok(screen.getByText('105%'));
    fireEvent.click(
      screen.getByRole('switch', { name: 'Hear My melody alone' }),
    );
    assert.deepEqual(
      arrangedTracks(song)
        .filter((t) => !t.muted)
        .map((t) => t.id),
      [song.tracks[0].id],
    );
    const other = song.tracks[1];
    fireEvent.click(
      screen.getByRole('switch', { name: `Hear ${other.name} alone` }),
    );
    assert.deepEqual(
      arrangedTracks(song)
        .filter((t) => !t.muted)
        .map((t) => t.id),
      [other.id],
    );
    fireEvent.click(
      screen.getByRole('switch', { name: `Hear ${other.name} alone` }),
    );
    assert.equal(
      song.tracks.some((t) => t.solo),
      false,
    );
  } finally {
    cleanup();
  }
});

void test('note editor names pitches, guides additions into key and snaps off-grid timing without changing the chosen pitch', async () => {
  const { NoteCleanup } = await import('../components/note-cleanup');
  const { inSongKey } = await import('../lib/music/cleanup');
  const song = sample();
  let track = {
    ...song.tracks[0],
    events: [{ ...song.tracks[0].events[0], time: 0.141, note: 61 }],
  };
  const context = {
    ...song.context!,
    tempo: 120,
    key: 0,
    mode: 'major' as const,
  };
  track.sourceTempo = 120;
  const ui = () => (
    <NoteCleanup
      track={track}
      context={context}
      onChange={(next) => {
        track = next;
        view.rerender(ui());
      }}
      onPlay={() => {}}
      onAudition={() => {}}
      playing={false}
      canUndo={false}
      onUndo={() => {}}
    />
  );
  const view = render(ui());
  try {
    const note = screen.getByRole('button', { name: 'Note 1, C♯4, beat 1.28' });
    fireEvent.keyDown(note, { key: 'ArrowRight' });
    assert.equal(track.events[0].time, 0.25);
    assert.equal(
      track.events[0].note,
      61,
      'timing changes preserve a recorded accidental',
    );
    fireEvent.keyDown(note, { key: 'ArrowUp' });
    assert.equal(track.events[0].note, 62);
    fireEvent.keyDown(note, { key: 'ArrowRight', shiftKey: true });
    const end = track.events[0].time + track.events[0].duration;
    assert.ok(Math.abs(end / 0.125 - Math.round(end / 0.125)) < 1e-8);
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    assert.ok(inSongKey(track.events.at(-1)!.note, context));
    assert.ok(
      Math.abs(
        track.events.at(-1)!.time / 0.125 -
          Math.round(track.events.at(-1)!.time / 0.125),
      ) < 1e-8,
    );
  } finally {
    cleanup();
  }
});

void test('cleanup auditions both versions and restores the saved source notes', async () => {
  const {saveSong,listSongs}=await import('../lib/music/storage');
  const aliases=registerHooks({resolve(specifier,context,next){return next(specifier==='next/link'?'vinext/shims/link':specifier,context);}});
  const {default:Composer}=await import('../components/composer'); aliases.deregister();
  const song=sample();song.updatedAt=Date.now()+1000;
  song.tracks[0].events[0].velocity=.35;
  // Keep source and performance consistent so undo restores the original take.
  song.tracks[0].intent.events[0].intensity=(.35-.12)/.82;
  await saveSong(song);localStorage.setItem('tapcomposer-service','free');
  // oxlint-disable-next-line typescript/unbound-method
  const oldPlay=AudioEngine.prototype.play;
  const auditions:Track[][]=[];
  AudioEngine.prototype.play=async tracks=>{auditions.push(tracks);return {startAt:0,duration:4};};
  try {
    render(<Composer/>);
    await waitFor(()=>assert.ok(screen.getByRole('button',{name:'My melody, bar 1, 1 bars'})));
    fireEvent.click(screen.getByRole('button',{name:'My melody, bar 1, 1 bars'}));
    fireEvent.click(screen.getByRole('button',{name:'More options'}));
    fireEvent.click(screen.getByRole('button',{name:'Clean up this part'}));
    await waitFor(()=>assert.equal(auditions.length,1));
    assert.equal(auditions[0][0].smoother,true);
    await waitFor(()=>assert.ok(!screen.getByRole('button',{name:'Undo cleanup'}).hasAttribute('disabled')));
    fireEvent.click(screen.getByRole('button',{name:'Undo cleanup'}));
    await waitFor(()=>assert.equal(auditions.length,2));
    assert.equal(auditions[1][0].smoother,false);
    assert.deepEqual(auditions[1][0].events,song.tracks[0].events);
    await waitFor(async()=>assert.equal((await listSongs()).find(s=>s.id===song.id)!.tracks[0].smoother,false));
  } finally {cleanup();AudioEngine.prototype.play=oldPlay;localStorage.clear();}
});

void test('the example plays before its studio download, and live feel changes can be undone', async () => {
  const { IDBFactory } = await import('fake-indexeddb');
  Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
  const { listSongs } = await import('../lib/music/storage');
  const aliases = registerHooks({ resolve(specifier, context, next) {
    return next(specifier === 'next/link' ? 'vinext/shims/link' : specifier, context);
  } });
  const { default: Composer } = await import('../components/composer');
  aliases.deregister();
  localStorage.clear();
  const oldFetch = globalThis.fetch;
  // oxlint-disable-next-line typescript/unbound-method
  const oldPlay = AudioEngine.prototype.play;
  const plays: Track[][] = [];
  AudioEngine.prototype.play = async (tracks) => {
    plays.push(tracks);
    return { startAt: 0, duration: 60 };
  };
  let finishDownload!: (response: Response) => void;
  globalThis.fetch = async (input) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).includes('/demo/')
    ? new Promise<Response>((resolve) => { finishDownload = resolve; })
    : new Response(JSON.stringify({ premium: false, ready: false }), { headers: { 'Content-Type': 'application/json' } });
  try {
    render(<Composer />);
    await waitFor(() => assert.ok(!screen.getByRole('button', { name: /Take it for a spin/ }).hasAttribute('disabled')));
    assert.equal(screen.queryByRole('button', { name: 'Play my song' }), null, 'A new visitor sees starting choices, not disabled studio controls');
    fireEvent.click(screen.getByRole('button', { name: /Take it for a spin/ }));
    await waitFor(() => assert.equal(plays.length, 1));
    assert.ok(plays[0].some((track) => track.events.length > 0));
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Stop playing' })));
    fireEvent.click(screen.getByRole('button', { name: 'Daydream' }));
    await waitFor(() => assert.equal(plays.length, 2));
    await waitFor(async () => assert.equal((await listSongs())[0].compose?.feel, 'dreamy'));
    finishDownload(new Response(new Blob(['audio'], { type: 'audio/wav' }), { headers: { 'Content-Type': 'audio/wav' } }));
    await waitFor(async () => assert.equal((await listSongs())[0].premiumTakes?.length, 1));
    assert.ok(screen.getByRole('button', { name: 'Stop playing' }), 'The studio download must not interrupt playback');
    assert.equal(plays.length, 2);
    fireEvent.click(screen.getByRole('button', { name: 'Show off' }));
    await waitFor(() => assert.ok(screen.getByRole('dialog')));
    assert.equal(plays.length, 2, 'Opening the listening view preserves playback');
    fireEvent.click(screen.getByRole('button', { name: 'Back to making music' }));
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    // The downloaded take is an undoable edit; then the feel is the preceding edit.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => assert.equal((await listSongs())[0].compose?.feel, 'easy'));
  } finally {
    cleanup();
    globalThis.fetch = oldFetch;
    AudioEngine.prototype.play = oldPlay;
    localStorage.clear();
  }
});

void test('the listening view follows audible notes and seeks to musical sections', async () => {
  const { SongSpotlight } = await import('../components/song-spotlight');
  const { arrangedTracks } = await import('../lib/music/composition');
  const { songDuration } = await import('../lib/music/resolve');
  const song = sample();
  const tracks = arrangedTracks(song);
  let seek = -1;
  let played = false;
  let saved = false;
  const props = {
    song, tracks, open: true, onOpenChange: () => {}, playing: true, loading: false,
    position: tracks[0].events[0].time + 0.01, duration: songDuration(tracks),
    onPlay: () => { played = true; }, onSeek: (seconds: number) => { seek = seconds; },
    onSave: () => { saved = true; }, error: '',
  };
  try {
    const view = render(<SongSpotlight {...props} />);
    assert.ok(document.querySelector('.spotlight-band .is-sounding'), 'An audible note lights its instrument');
    const section = song.sections![1];
    fireEvent.click(screen.getByRole('button', { name: section.name }));
    assert.equal(seek, song.sections![0].bars * 4 * 60 / song.context!.tempo);
    fireEvent.click(screen.getByRole('button', { name: 'Stop playing' }));
    assert.equal(played, true);
    fireEvent.click(screen.getByRole('button', { name: 'Save audio' }));
    assert.equal(saved, true);
    view.rerender(<SongSpotlight {...props} playing={false} />);
    assert.equal(document.querySelector('.spotlight-band .is-sounding'), null);
    assert.ok(screen.getByRole('button', { name: 'Play my song' }));
  } finally { cleanup(); }
});

void test('a track retake opens in its previous input mode and leaves the old take intact until kept', async () => {
  const { keepIdea } = await import('../lib/music/composition');
  const song = sample();
  const original = song.tracks[0];
  original.intent = { ...original.intent, source: 'touch' };
  const engine = new AudioEngine();
  engine.ready = async () => ({}) as AudioContext;
  engine.tap = async () => {};
  engine.stop = () => {};
  engine.play = async () => ({ startAt: 0, duration: 4 });
  engine.load = async () => {};
  let kept: Song = song;
  let closed = false;
  const now = performance.now.bind(performance);
  let clock = 10000;
  Object.defineProperty(performance, 'now', { value: () => clock, configurable: true });
  try {
    render(<Recorder instrument={original.instrument} replaceId={original.id} song={song} engine={engine}
      onClose={() => { closed = true; }} onKeep={(track, context) => { kept = keepIdea(song, track, context); }} />);
    assert.ok(screen.getByRole('heading', { name: 'Record My melody again.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tap rhythm pad' }));
    await waitFor(() => assert.ok(screen.getByText('1 tap')));
    for (let i = 0; i < 3; i++) {
      clock += 500;
      fireEvent.click(screen.getByRole('button', { name: 'Tap rhythm pad' }));
    }
    clock += 500;
    fireEvent.click(screen.getByRole('button', { name: 'Hear my idea' }));
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Keep new take' })));
    assert.equal(kept, song, 'Auditioning must not replace the saved track');
    fireEvent.click(screen.getByRole('button', { name: 'Keep current take' }));
    assert.equal(closed, true);
    assert.equal(kept, song);
    fireEvent.click(screen.getByRole('button', { name: 'Keep new take' }));
    assert.equal(kept.tracks[0].id, original.id);
    assert.equal(kept.tracks[0].name, original.name);
    assert.notDeepEqual(kept.tracks[0].events, original.events);
    assert.equal(kept.tracks.length, song.tracks.length);
    song.tracks.slice(1).forEach((track, index) => assert.equal(kept.tracks[index + 1], track));
  } finally {
    Object.defineProperty(performance, 'now', { value: now, configurable: true });
    cleanup();
  }
});

void test('Tuning Center synchronizes the guide, preserves drafts during rehearsal, and keeps rerecordings and saved progress', async () => {
  const { IDBFactory } = await import('fake-indexeddb');
  Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
  const { latestLab } = await import('../lib/voice-lab/storage');
  const { MELODIES, melodyScore } = await import('../lib/voice-lab/protocol');
  const aliases = registerHooks({ resolve(specifier, context, next) { return next(specifier === 'next/link' ? 'vinext/shims/link' : specifier, context); } });
  const { default: TuningCenter } = await import('../components/voice-lab/tuning-center');
  const { AnalysisClient } = await import('../lib/music/analysis-client');
  const oldAnalyze = Object.getOwnPropertyDescriptor(AnalysisClient.prototype, 'analyze')!;
  AnalysisClient.prototype.analyze = () => ({result: Promise.resolve({version:1,source:'hum',duration:6,confidence:.9,events:[{time:1,duration:.2,pitch:59.2,confidence:.9,intensity:.7},{time:1.2,duration:1,pitch:60,confidence:.9,intensity:.7,pitchDrift:true}]}),cancel() {}});
  aliases.deregister();
  const oldMedia = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  const oldWorklet = globalThis.AudioWorkletNode;
  const oldMethods = Object.getOwnPropertyDescriptors(AudioEngine.prototype);
  const oldPause = Object.getOwnPropertyDescriptor(dom.window.HTMLMediaElement.prototype, 'pause');
  Object.defineProperty(dom.window.HTMLMediaElement.prototype, 'pause', { value: () => {}, configurable: true });
  let released = 0;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { released++; } }] }) } });
  const clock = { currentTime: 10, sampleRate: 16000, destination: {}, decodeAudioData: async () => ({sampleRate:16000,getChannelData:()=>new Float32Array(96000)}), createMediaStreamSource: () => ({connect() {}, disconnect() {}}) };
  const nodes: FakeLabWorklet[] = [];
  class FakeLabWorklet {
    startAt: number;
    commands: string[] = [];
    port = { onmessage: null as ((event: {data:{type:string;pcm:Float32Array}}) => void) | null, postMessage: (command: string) => {
      this.commands.push(command);
      if (command === 'stop') this.port.onmessage?.({data:{type:'complete',pcm:Float32Array.from({length: Math.round(melodyScore(MELODIES[0],48,90).duration * clock.sampleRate)}, (_,i) => .1*Math.sin(i*.1))}});
    }, close() {} };
    constructor(_context: unknown, _name: string, options: {processorOptions:{startAt:number}}) { this.startAt = options.processorOptions.startAt; nodes.push(this); }
    connect() {}
    disconnect() {}
  }
  globalThis.AudioWorkletNode = FakeLabWorklet as unknown as typeof AudioWorkletNode;
  const scheduled: (number | undefined)[] = [];
  const previews: Track[][] = [];
  const overrides = {
    prepareCapture: { value: async () => clock },
    ready: { value: async () => clock },
    stop: { value: () => {} },
    close: { value: async () => {} },
    currentTime: { get: () => clock.currentTime },
    play: { value: async (_tracks: Track[], _repeat: boolean, _end: () => void, startAt?: number) => { previews.push(_tracks); scheduled.push(startAt); return {startAt:startAt ?? clock.currentTime,duration:6}; } },
  };
  for (const [key, descriptor] of Object.entries(overrides)) Object.defineProperty(AudioEngine.prototype, key, {...descriptor,configurable:true});
  try {
    const view = render(<TuningCenter />);
    await waitFor(() => assert.ok(!screen.getByRole('button',{name:'Record my take'}).hasAttribute('disabled')));
    assert.equal(screen.getByRole('complementary',{name:'Choose a melody'}).querySelectorAll('button').length,15);
    fireEvent.click(screen.getByRole('button',{name:'Daa'}));
    assert.ok(screen.getByText(/Start every note with a soft D/));
    fireEvent.click(screen.getByRole('button',{name:'Record my take'}));
    await waitFor(() => assert.equal(nodes.length,1));
    assert.equal(scheduled[0],nodes[0].startAt);
    fireEvent.click(screen.getByRole('button',{name:'Cancel take'}));
    assert.equal(released,1);
    assert.equal(await latestLab(),null);
    fireEvent.click(screen.getByRole('button',{name:'Record my take'}));
    await waitFor(() => assert.equal(nodes.length,2));
    clock.currentTime = nodes[1].startAt + melodyScore(MELODIES[0],48,90).duration + .02;
    await waitFor(() => assert.ok(screen.getByRole('button',{name:'Keep this take'})));
    assert.equal(await latestLab(),null,'Review does not save a draft');
    fireEvent.click(screen.getByRole('button',{name:'Hear the melody'}));
    await waitFor(() => assert.ok(screen.getByRole('button',{name:'Stop reference'})));
    fireEvent.click(screen.getByRole('button',{name:'Stop reference'}));
    assert.ok(screen.getByRole('button',{name:'Keep this take'}),'Rehearsal must not discard a draft');
    fireEvent.click(screen.getByRole('button',{name:'Run detector'}));
    await waitFor(() => assert.ok(screen.getByRole('button',{name:'Hear cleaned phrase'})));
    fireEvent.click(screen.getByRole('button',{name:'Hear detected melody'}));
    await waitFor(() => assert.equal(previews.at(-1)![0].events.length,2));
    fireEvent.click(screen.getByRole('button',{name:'Hear cleaned phrase'}));
    await waitFor(() => assert.equal(previews.at(-1)![0].events.length,1));
    assert.ok(screen.getByRole('button',{name:'Stop cleaned phrase'}));
    fireEvent.click(screen.getByRole('button',{name:'Stop cleaned phrase'}));
    fireEvent.click(screen.getByRole('button',{name:'Keep this take'}));
    await waitFor(async () => assert.equal((await latestLab())?.takes.length,1));
    await waitFor(() => assert.ok(screen.getByRole('button',{name:'Rerecord this exercise'})));
    fireEvent.click(screen.getByRole('button',{name:'Rerecord this exercise'}));
    await waitFor(() => assert.equal(nodes.length,3));
    clock.currentTime = nodes[2].startAt + melodyScore(MELODIES[0],48,90).duration + .02;
    await waitFor(() => assert.ok(screen.getByRole('button',{name:'Keep & next melody'})));
    fireEvent.click(screen.getByRole('button',{name:'Keep & next melody'}));
    await waitFor(async () => assert.equal((await latestLab())?.takes.length,2));
    await waitFor(() => assert.ok(screen.getByRole('heading',{name:'Same note, new syllable'})));
    const saved = (await latestLab())!;
    assert.equal(saved.takes[0].style,'daa');
    assert.equal(saved.takes[0].trialKey,saved.takes[1].trialKey);
    assert.notEqual(saved.takes[0].id,saved.takes[1].id);
    fireEvent.change(screen.getByLabelText('Listening through'),{target:{value:'speakers'}});
    const guide = screen.getByRole('checkbox',{name:'Play the melody while I record'}) as HTMLInputElement;
    assert.equal(guide.checked,false);
    assert.equal(guide.disabled,true);
    view.unmount();
    render(<TuningCenter />);
    await waitFor(() => assert.ok(screen.getByRole('button',{name:'Export session (2 takes)'})));
  } finally {
    cleanup();
    Object.defineProperty(AnalysisClient.prototype, 'analyze', oldAnalyze);
    for (const key of Object.keys(overrides)) Object.defineProperty(AudioEngine.prototype,key,oldMethods[key]);
    if (oldPause) Object.defineProperty(dom.window.HTMLMediaElement.prototype,'pause',oldPause);
    globalThis.AudioWorkletNode = oldWorklet;
    if (oldMedia) Object.defineProperty(navigator,'mediaDevices',oldMedia); else Reflect.deleteProperty(navigator,'mediaDevices');
  }
});
