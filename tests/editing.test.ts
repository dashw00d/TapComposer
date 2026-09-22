import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDemoSong } from '../lib/music/demo';
import {
  addClip,
  copyClip,
  moveClip,
  removeClip,
  songClips,
} from '../lib/music/clips';
import {
  editNoteGeometry,
  editNote,
  trimQuietEdges,
  fitLoopToNotes,
} from '../lib/music/cleanup';
import {
  arrangedTracks,
  changeInstrument,
  composeSong,
  keepIdea,
} from '../lib/music/composition';
import { exportProject, importProject } from '../lib/music/project';
import { songHistoryReducer } from '../hooks/use-song-history';
import { songFingerprint } from '../lib/premium/client';

void test('materializing a timeline preserves the full arrangement, entrances, fades and musical fingerprint', () => {
  const song = makeDemoSong();
  assert.equal(
    songFingerprint({ ...song, clips: songClips(song) }),
    songFingerprint(song),
  );
  song.sections![0].parts = {
    [song.tracks[0].id]: {
      offsetBeats: 2,
      repeat: true,
      transpose: 12,
      fadeInBeats: 3,
      fadeOutBeats: 2,
    },
  };
  const manual = { ...song, clips: songClips(song) };
  const precision = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value, (_, v) =>
        typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v,
      ),
    );
  assert.deepEqual(
    precision(arrangedTracks(manual)),
    precision(arrangedTracks(song)),
  );
});
void test('moving, resizing, copying and deleting a block change audible events and keep the recording', () => {
  const original = makeDemoSong();
  const clip = songClips(original).find(
    (c) => c.trackId === original.tracks[0].id,
  )!;
  const song = { ...original, clips: [clip] };
  const moved = moveClip(song, clip.id, 4, 4);
  const events = arrangedTracks(moved)[0].events;
  assert.equal(events[0].time, (4 * 60) / song.context!.tempo);
  assert.ok(
    events.every(
      (e) => e.time + e.duration <= (8 * 60) / song.context!.tempo + 1e-8,
    ),
  );
  assert.notEqual(songFingerprint(moved), songFingerprint(song));
  const copied = copyClip(moved, clip.id);
  assert.equal(arrangedTracks(copied)[0].events.length, events.length * 2);
  assert.equal(copied.clips![1].startBeat, 8);
  const deleted = removeClip(copied, clip.id);
  assert.equal(
    arrangedTracks(deleted)[0].events[0].time,
    (8 * 60) / song.context!.tempo,
  );
  assert.equal(deleted.tracks[0], original.tracks[0]);
  const slow = {
    ...moved,
    context: { ...moved.context!, tempo: moved.context!.tempo / 2 },
    tracks: moved.tracks.map((t) => ({
      ...t,
      sourceTempo: moved.context!.tempo,
    })),
  };
  assert.equal(arrangedTracks(slow)[0].events[0].time, events[0].time * 2);
});
void test('timeline edits survive composition, new recordings, undo and project backups', async () => {
  const original = makeDemoSong();
  const clip = songClips(original)[0];
  const moved = moveClip(original, clip.id, 2, 8);
  const composed = composeSong(moved, { variation: 2, feel: 'dreamy' });
  assert.deepEqual(
    composed.clips!.find((c) => c.id === clip.id),
    moved.clips!.find((c) => c.id === clip.id),
  );
  assert.ok(
    composed.clips!.every((c) =>
      composed.tracks.some((t) => t.id === c.trackId),
    ),
  );
  const added = keepIdea(
    composed,
    { ...original.tracks[0], id: 'new-recording' },
    original.context!,
  );
  assert.equal(
    added.clips!.filter((c) => c.trackId === 'new-recording').length,
    original.sections!.length,
  );
  assert.equal(
    addClip(added, 'new-recording', 500).clips!.length,
    added.clips!.length + 1,
  );
  const reopened = await importProject(await exportProject(added));
  assert.deepEqual(reopened.clips, JSON.parse(JSON.stringify(added.clips)));
  const edited = songHistoryReducer(
    { present: original, past: [], future: [] },
    { type: 'edit', song: moved },
  );
  assert.equal(songHistoryReducer(edited, { type: 'undo' }).present, original);
  await assert.rejects(
    importProject(
      await exportProject({ ...moved, clips: [{ ...clip, startBeat: -1 }] }),
    ),
    /invalid timeline/,
  );
  await assert.rejects(
    importProject(
      await exportProject({
        ...moved,
        clips: [{ ...clip, trackId: 'missing' }],
      }),
    ),
    /invalid timeline/,
  );
});
void test('individual note edits preserve source audio, survive changing sound and auto-composition, and undo exactly', () => {
  const song = makeDemoSong();
  const original = { ...song.tracks[0], original: new Blob(['source']) };
  const moved = editNoteGeometry(original, 0, {
    note: 61,
    time: 0.125,
    duration: 0.2,
  });
  assert.equal(moved.intent, original.intent);
  assert.equal(moved.original, original.original);
  assert.equal(moved.events[1], original.events[1]);
  const removed = editNote(moved, 1, 'remove');
  const strings = changeInstrument(removed, 'strings', song.context!);
  assert.deepEqual(strings.events, removed.events);
  assert.equal(strings.duration, removed.duration);
  const regenerated = composeSong({
    ...song,
    tracks: [strings, ...song.tracks.slice(1)],
  });
  assert.deepEqual(regenerated.tracks[0].events, removed.events);
  const trimmed = trimQuietEdges(removed);
  assert.equal(trimmed.events[0].time, 0);
  assert.equal(trimmed.intent, original.intent);
  const bounded = editNoteGeometry(original, 0, {
    time: 900,
    duration: 900,
    note: -100,
  });
  assert.ok(bounded.events[0].time + bounded.events[0].duration <= 120);
  assert.equal(bounded.events[0].note, 0);
  assert.equal(bounded.duration, 120);
});

void test('fitting a sparse recording removes edge silence and repeats on a complete bar', async () => {
  const song = makeDemoSong();
  const source = {
    ...song.tracks[0],
    sourceTempo: 120,
    duration: 30,
    events: [
      { time: 11, duration: 0.3, note: 60, velocity: 0.7 },
      { time: 11.5, duration: 0.4, note: 62, velocity: 0.7 },
    ],
  };
  const fitted = fitLoopToNotes(source, 90);
  assert.equal(
    fitted.duration,
    2,
    'use the recording tempo rather than the current playback speed',
  );
  assert.deepEqual(
    fitted.events.map((e) => e.time),
    [0, 0.5],
  );
  assert.equal(fitted.intent, source.intent);
  assert.equal(fitted.original, source.original);
  assert.equal(source.duration, 30);
  assert.deepEqual(
    changeInstrument(fitted, 'strings', song.context!).events,
    fitted.events,
  );
  const restored = await importProject(
    await exportProject({ ...song, tracks: [fitted, ...song.tracks.slice(1)] }),
  );
  assert.deepEqual(restored.tracks[0].events, fitted.events);
  assert.equal(restored.tracks[0].duration, 2);
});

void test('magnetic note edits land on the grid and musical keys without rewriting captured pitches', async () => {
  const { guidedPitch, inSongKey, magneticTime, stepTime, noteName } =
    await import('../lib/music/cleanup');
  assert.equal(noteName(61), 'C♯4');
  for (const mode of ['major', 'minor'] as const)
    for (let key = 0; key < 12; key++)
      for (let note = 28; note < 90; note++) {
        const guided = guidedPitch(note, { key, mode }, 1);
        assert.ok(inSongKey(guided, { key, mode }));
        assert.ok(Math.abs(guided - note) <= 1);
      }
  assert.equal(guidedPitch(61, { key: 0, mode: 'major' }, 1), 62);
  assert.equal(guidedPitch(61, { key: 0, mode: 'major' }, -1), 60);
  assert.equal(magneticTime(0.141, 0.5), 0.125);
  assert.equal(stepTime(0.141, 0.5, -1), 0.125);
  assert.equal(stepTime(0.141, 0.5, 1), 0.25);
});
void test('explicit musical directions work on protected parts and releasing protection keeps the other parts safe', async () => {
  const { directPart, setPartProtection } = await import('../lib/music/direct');
  const song = makeDemoSong();
  song.tracks[0].pinned = true;
  song.sections![0].pinned = true;
  const before = song.tracks[0];
  const changed = directPart(song, before.id, 'simpler', true);
  assert.ok(changed.tracks[0].events.length < before.events.length);
  assert.equal(changed.tracks[0].intent, before.intent);
  assert.equal(changed.tracks[0].pinned, true);
  const released = setPartProtection(song, before.id, false);
  assert.equal(released.tracks[0].pinned, false);
  assert.equal(released.sections![0].pinned, false);
  for (const id of song.sections![0].trackIds.filter((id) => id !== before.id))
    assert.equal(released.tracks.find((t) => t.id === id)!.pinned, true);
});
