import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDemoSong } from '../lib/music/demo';
import {
  composeSong,
  arrangedTracks,
  keepIdea,
} from '../lib/music/composition';
import {
  directPart,
  DIRECTIONS,
  forkDirection,
  layerIdea,
  reorderSection,
  resizeSection,
  shapeJourney,
} from '../lib/music/direct';
import { comparisonLevels, comparisonSeek } from '../lib/music/compare';
import {
  sectionExpression,
  seekExpression,
  gainAt,
} from '../lib/music/expression';
import { songFingerprint } from '../lib/premium/client';
import { exportProject, importProject } from '../lib/music/project';
import { saveSong, listSongs } from '../lib/music/storage';

void test('kept generated parts, sections and harmony survive automatic changes and new ideas', () => {
  const song = makeDemoSong();
  const backing = song.tracks.find((t) => t.generated)!;
  backing.pinned = true;
  song.sections![0].pinned = true;
  song.harmonyPinned = true;
  const fingerprint = songFingerprint(song);
  const next = composeSong(song, { feel: 'driving', energy: 1, variation: 7 });
  assert.deepEqual(
    next.tracks.find((t) => t.id === backing.id),
    backing,
  );
  assert.deepEqual(next.sections![0], song.sections![0]);
  assert.deepEqual(next.context, song.context);
  for (const id of song.sections![0].trackIds)
    assert.deepEqual(
      next.tracks.find((t) => t.id === id),
      song.tracks.find((t) => t.id === id),
    );
  const added = keepIdea(
    song,
    { ...song.tracks[0], id: 'new-melody' },
    { ...song.context!, key: 9 },
  );
  assert.deepEqual(added.context, song.context);
  assert.deepEqual(added.sections![0], song.sections![0]);
  assert.equal(
    songFingerprint({
      ...song,
      harmonyPinned: false,
      name: 'Renamed',
      tracks: song.tracks.map((t) => ({ ...t, pinned: !t.pinned })),
    }),
    fingerprint,
  );
});
void test('musical directions change performances while retaining source recordings and intentions', () => {
  const song = makeDemoSong(),
    track = song.tracks.find((t) => t.instrument === 'bass')!;
  track.original = new Blob(['source']);
  for (const { id } of DIRECTIONS) {
    const next = directPart(song, track.id, id),
      changed = next.tracks.find((t) => t.id === track.id)!;
    assert.notEqual(songFingerprint(next), songFingerprint(song), id);
    assert.equal(changed.intent, track.intent);
    assert.equal(changed.original, track.original);
    assert.equal(changed.generated, track.generated);
    assert.equal(changed.pinned, true);
    assert.ok(
      changed.events.every(
        (e) => Number.isFinite(e.note) && e.duration > 0 && e.time >= 0,
      ),
    );
    assert.equal(directPart(next, track.id, 'simpler'), next);
  }
  assert.equal(track.pinned, undefined);
  assert.equal(
    directPart({ ...song, context: null }, track.id, 'movement').context,
    null,
  );
});
void test('one recording can become layered instruments without duplicate identities or lost audio', () => {
  const song = makeDemoSong(),
    original = song.tracks[0];
  original.original = new Blob(['recorded hum']);
  const layers = layerIdea(
    song,
    original,
    ['piano', 'strings', 'piano', 'bass'],
    song.context!,
  );
  assert.equal(layers.length, 3);
  assert.equal(layers[0].id, original.id);
  assert.equal(new Set(layers.map((t) => t.id)).size, 3);
  for (const t of layers) {
    assert.equal(t.original, original.original);
    assert.equal(t.intent, original.intent);
  }
  const full = {
    ...song,
    tracks: Array.from({ length: 24 }, (_, i) => ({
      ...original,
      id: `part-${i}`,
    })),
  };
  assert.equal(
    layerIdea(full, full.tracks[0], ['piano', 'strings'], song.context!).length,
    1,
  );
});
void test('journey changes instrumentation and dynamics, skips kept sections, and bounds resizing', () => {
  const song = makeDemoSong();
  song.sections![0].pinned = true;
  const shaped = shapeJourney(song, [1, 0.1, 0.9, 1, 0.1], true);
  assert.deepEqual(shaped.sections![0], song.sections![0]);
  assert.notDeepEqual(
    shaped.sections![1].trackIds,
    shaped.sections![3].trackIds,
  );
  assert.ok(shaped.sections!.every((s) => s.bars >= 2 && s.bars <= 32));
  const section = shaped.sections![1];
  section.parts = {
    [song.tracks[0].id]: {
      offsetBeats: 30,
      repeat: true,
      transpose: 0,
      fadeInBeats: 16,
    },
  };
  const short = resizeSection(shaped, section.id, 2);
  assert.equal(short.sections![1].parts![song.tracks[0].id].offsetBeats, 7);
  assert.equal(short.sections![1].parts![song.tracks[0].id].fadeInBeats, 8);
  assert.equal(
    reorderSection(song, song.sections![0].id, song.sections![2].id)
      .sections![2].id,
    song.sections![0].id,
  );
});
void test('alternate directions persist independently, including pins, fades and source audio in backups', async () => {
  const song = makeDemoSong();
  song.tracks[0].pinned = true;
  song.tracks[0].original = new Blob(['hum']);
  song.sections![0].pinned = true;
  song.sections![0].parts = {
    [song.tracks[0].id]: {
      offsetBeats: 0,
      repeat: true,
      transpose: 0,
      fadeInBeats: 4,
      fadeOutBeats: 8,
    },
  };
  const branch = forkDirection(song, 'Quiet version');
  assert.notEqual(branch.id, song.id);
  assert.equal(branch.branchedFrom, song.id);
  await saveSong(song);
  await saveSong({ ...branch, name: 'Changed branch' });
  const saved = await listSongs();
  assert.equal(saved.find((s) => s.id === song.id)!.name, song.name);
  assert.equal(saved.find((s) => s.id === branch.id)!.name, 'Changed branch');
  const restored = await importProject(await exportProject(branch));
  assert.equal(restored.branchedFrom, song.id);
  assert.equal(restored.tracks[0].pinned, true);
  assert.deepEqual(restored.sections, branch.sections);
  assert.equal(await restored.tracks[0].original!.text(), 'hum');
  const bad = JSON.parse(await (await exportProject(branch)).text());
  bad.sections[0].parts[song.tracks[0].id].fadeInBeats = 'loud';
  await assert.rejects(
    importProject(new Blob([JSON.stringify(bad)])),
    /invalid part timing/,
  );
});
void test('comparison attenuates louder audio, handles silence, and clamps a shared playback position', () => {
  const buffer = (n: number) => ({
    numberOfChannels: 1,
    getChannelData: () => new Float32Array([n, -n, n, -n]),
  });
  assert.deepEqual(
    comparisonLevels([buffer(0.25), buffer(0.5), buffer(0)]),
    [1, 0.5, 1],
  );
  assert.deepEqual(comparisonLevels([buffer(0), buffer(0)]), [1, 1]);
  assert.equal(comparisonSeek(12, 20), 12);
  assert.equal(comparisonSeek(12, 10), 9.95);
});
void test('fades interpolate through sustained notes and retain their position when seeking', () => {
  const points = sectionExpression(
    {
      offsetBeats: 0,
      repeat: true,
      transpose: 0,
      fadeInBeats: 4,
      fadeOutBeats: 4,
    },
    0,
    8,
    8,
    0.5,
  )!;
  assert.equal(gainAt(points, 0), 0);
  assert.equal(gainAt(points, 1), 0.5);
  assert.equal(gainAt(points, 2), 1);
  assert.equal(gainAt(points, 4), 0);
  const sought = seekExpression(points, 3)!;
  assert.equal(gainAt(sought, 0), 0.5);
  assert.equal(gainAt(sought, 1), 0);
  const song = makeDemoSong(),
    section = song.sections![0],
    track = song.tracks[0];
  const unchanged = songFingerprint(song);
  section.parts = {
    [track.id]: { offsetBeats: 0, repeat: true, transpose: 0, fadeInBeats: 8 },
  };
  assert.ok(arrangedTracks(song)[0].events[0].expression?.length);
  assert.notEqual(songFingerprint(song), unchanged);
});

void test('keeping tap-only harmony freezes its current progression during new variations', async () => {
  const { chordAt } = await import('../lib/music/harmony');
  const demo = makeDemoSong();
  const song = composeSong(
    {
      ...demo,
      tracks: demo.tracks.filter((t) => t.instrument === 'drums'),
      sections: undefined,
      context: { ...demo.context!, chords: undefined },
    },
    { variation: 1 },
  );
  const expected = [0, 4, 8, 12].map((at) => chordAt(at, song.context!, 1));
  const kept = composeSong({ ...song, harmonyPinned: true }, { variation: 2 });
  assert.deepEqual(kept.context!.chords, expected);
});
void test('older studio takes still match after adding nonmusical pin controls', async () => {
  const { matchesSong } = await import('../lib/premium/client');
  const song = makeDemoSong();
  const text = JSON.stringify({
    context: song.context,
    tracks: arrangedTracks(song),
  });
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  song.tracks[0].pinned = true;
  assert.ok(matchesSong((hash >>> 0).toString(16), song));
  song.tracks[0].events = song.tracks[0].events.slice(1);
  assert.equal(matchesSong((hash >>> 0).toString(16), song), false);
});
void test('MIDI exports section fades as expression controllers', async () => {
  const { exportMidi } = await import('../lib/music/midi');
  const song = makeDemoSong(),
    track = song.tracks[0];
  song.sections![0].parts = {
    [track.id]: {
      offsetBeats: 0,
      repeat: true,
      transpose: 0,
      fadeInBeats: 8,
      fadeOutBeats: 4,
    },
  };
  const bytes = new Uint8Array(await exportMidi(song).arrayBuffer());
  assert.ok(
    bytes.some(
      (value, i) => value === 176 && bytes[i + 1] === 11 && bytes[i + 2] === 0,
    ),
  );
  assert.ok(
    bytes.some(
      (value, i) =>
        value === 176 &&
        bytes[i + 1] === 11 &&
        bytes[i + 2] > 0 &&
        bytes[i + 2] < 127,
    ),
  );
});

void test('reassigning a suggested instrument preserves its provenance and the manual choice', async () => {
  const { changeInstrument } = await import('../lib/music/composition');
  const song = makeDemoSong(),
    track = song.tracks.find((t) => t.generated)!;
  const changed = changeInstrument(track, 'strings', song.context!);
  assert.equal(changed.generated, true);
  assert.equal(changed.edited, true);
  const next = composeSong(
    {
      ...song,
      tracks: song.tracks.map((t) => (t.id === track.id ? changed : t)),
    },
    { variation: 3 },
  );
  assert.deepEqual(
    next.tracks.find((t) => t.id === track.id),
    changed,
  );
});
