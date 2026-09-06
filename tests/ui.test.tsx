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
void test('piano accepts tap input, previews interpreted chords, then keeps the original idea', async () => {
  const engine = new AudioEngine();
  engine.ready = async () => ({}) as AudioContext;
  engine.tap = async () => {};
  engine.stop = () => {};
  engine.play = async () => ({ startAt: 0, duration: 4 });
  engine.load = async () => {};
  let kept: Track | null = null;
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
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
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
