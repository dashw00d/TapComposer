import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newSong,
  type Instrument,
  type Song,
  type Track,
} from '../lib/music/types';
import { buildIntent } from '../lib/music/analyze';
import { inferContext, resolveIntent } from '../lib/music/resolve';
import {
  arrangedTracks,
  changeInstrument,
  composeSong,
  moveSection,
  patternTracks,
  sectionLength,
  keepIdea,
} from '../lib/music/composition';
import { exportProject, importProject } from '../lib/music/project';
import { exportMidi } from '../lib/music/midi';
import { songHistoryReducer } from '../hooks/use-song-history';
function idea(instrument: Instrument = 'piano', hum = true): Song {
  const intent = buildIntent(
    hum ? 'hum' : 'touch',
    [0, 0.5, 1, 1.5, 2, 2.5].map((time, i) => ({
      time,
      duration: 0.35,
      pitch: hum ? [60, 64, 67, 65, 64, 60][i] : null,
      confidence: 0.95,
      intensity: 0.7,
    })),
    4,
  );
  const context = inferContext(intent);
  const track: Track = {
    id: 'my-idea',
    instrument,
    name: 'My idea',
    intent,
    ...resolveIntent(intent, instrument, context),
    original: new Blob(['my original']),
    muted: false,
    smoother: false,
    sourceTempo: context.tempo,
  };
  return { ...newSong(), context, tracks: [track] };
}
void test('empty project backups reopen and duplicate section identities are rejected', async () => {
  const empty = await importProject(await exportProject(newSong()));
  assert.equal(empty.context, null);
  assert.equal(empty.tracks.length, 0);
  const song = composeSong(idea());
  song.sections![1].id = song.sections![0].id;
  await assert.rejects(
    importProject(await exportProject(song)),
    /duplicate sections/,
  );
});
void test('legacy songs without sections follow speed changes without changing source timing', () => {
  const song = idea();
  const source = song.tracks[0];
  const slower = {
    ...song,
    context: { ...song.context!, tempo: song.context!.tempo / 2 },
  };
  const arranged = arrangedTracks(slower)[0];
  assert.equal(arranged.duration, source.duration * 2);
  assert.equal(arranged.events[1].time, source.events[1].time * 2);
});
void test('keeping a later idea adds it to the song, while replacement preserves chosen entrances', () => {
  const song = composeSong(idea());
  const second = { ...idea('synth').tracks[0], id: 'second' };
  const expanded = keepIdea(song, second, song.context!);
  assert.ok(
    expanded.sections!.every((section) => section.trackIds.includes(second.id)),
  );
  assert.ok(
    arrangedTracks(expanded).find((track) => track.id === second.id)!.events
      .length > 0,
  );
  expanded.sections![0].trackIds = expanded.sections![0].trackIds.filter(
    (id) => id !== second.id,
  );
  const replaced = keepIdea(expanded, second, song.context!);
  assert.ok(!replaced.sections![0].trackIds.includes(second.id));
});
void test('a hum becomes a structured song with backing while source melody and recording stay intact', () => {
  const input = idea(),
    song = composeSong(input);
  assert.equal(song.tracks[0], input.tracks[0]);
  assert.equal(song.sections?.length, 5);
  assert.equal(sectionLength(song), 112);
  assert.ok(song.tracks.some((t) => t.instrument === 'bass' && t.generated));
  assert.ok(song.tracks.some((t) => t.instrument === 'drums' && t.generated));
  assert.ok(
    song.sections![0].trackIds.length < song.sections![1].trackIds.length,
  );
  assert.ok(
    arrangedTracks(song).some(
      (t) => t.events.length > input.tracks[0].events.length,
    ),
  );
});
void test('tap-only ideas create pitched music, and every instrument can interpret either input', () => {
  const song = composeSong(idea('drums', false));
  assert.ok(
    song.tracks.some(
      (t) => t.instrument === 'synth' && t.events.some((e) => e.note > 48),
    ),
  );
  const instruments: Instrument[] = [
    'piano',
    'drums',
    'bass',
    'guitar',
    'strings',
    'synth',
  ];
  for (const instrument of instruments)
    for (const hum of [true, false]) {
      const input = idea(instrument, hum);
      assert.ok(input.tracks[0].events.length > 0);
      assert.ok(
        input.tracks[0].events.every(
          (e) => Number.isFinite(e.note) && e.duration > 0,
        ),
      );
    }
  assert.ok(
    idea('piano', false).tracks[0].events.length > 6,
    'Taps should produce chords',
  );
});
void test('instrument changes preserve source identity and recording while changing performance', () => {
  const input = idea(),
    track = input.tracks[0];
  for (const instrument of [
    'bass',
    'drums',
    'strings',
    'guitar',
    'synth',
  ] as const) {
    const changed = changeInstrument(track, instrument, input.context!);
    assert.equal(changed.intent, track.intent);
    assert.equal(changed.original, track.original);
    assert.equal(changed.id, track.id);
    assert.equal(changed.instrument, instrument);
  }
  assert.ok(
    changeInstrument(track, 'bass', input.context!).events.every(
      (e) => e.note <= 52,
    ),
  );
});
void test('feel and variation preserve manual structure, source tracks, and mix choices', () => {
  const song = composeSong(idea());
  song.sections![0].name = 'My opening';
  song.sections![0].bars = 2;
  const bass = song.tracks.find((t) => t.instrument === 'bass')!;
  bass.volume = 0.2;
  bass.muted = true;
  const changed = composeSong(song, {
    feel: 'dreamy',
    energy: 0.9,
    variation: 2,
  });
  assert.equal(changed.sections![0].name, 'My opening');
  assert.equal(changed.sections![0].bars, 2);
  assert.equal(
    changed.tracks.find((t) => t.instrument === 'bass')!.volume,
    0.2,
  );
  assert.equal(
    changed.tracks.find((t) => t.instrument === 'bass')!.muted,
    true,
  );
  assert.deepEqual(changed.tracks[0].events, song.tracks[0].events);
  assert.ok(
    changed.sections!.every((s) =>
      s.trackIds.every((id) => changed.tracks.some((t) => t.id === id)),
    ),
  );
});
void test('tempo edits scale the whole composition while the source patterns stay untouched', () => {
  const song = composeSong(idea()),
    originalTempo = song.context!.tempo;
  const faster = {
    ...song,
    context: { ...song.context!, tempo: originalTempo * 1.5 },
  };
  const a = arrangedTracks(song),
    b = arrangedTracks(faster);
  assert.ok(Math.abs(a[0].duration / 1.5 - b[0].duration) < 0.00001);
  for (let i = 0; i < Math.min(a[0].events.length, 20); i++)
    assert.ok(
      Math.abs(a[0].events[i].time / 1.5 - b[0].events[i].time) < 0.00001,
    );
  assert.deepEqual(song.tracks[0].events, faster.tracks[0].events);
});
void test('section membership, movement, and solo determine the actual rendered event stream', () => {
  const song = composeSong(idea());
  const bass = song.tracks.find((t) => t.instrument === 'bass')!;
  const opening = arrangedTracks(song, song.sections![0].id);
  assert.equal(opening.find((t) => t.id === bass.id)!.events.length, 0);
  const swapped = moveSection(song, song.sections![1].id, -1);
  assert.equal(swapped.sections![0].id, song.sections![1].id);
  song.tracks[0].solo = true;
  assert.ok(
    arrangedTracks(song)
      .filter((t) => !t.muted)
      .every((t) => t.id === song.tracks[0].id),
  );
  assert.ok(
    patternTracks(song)[0].events.length >= song.tracks[0].events.length,
  );
});
void test('project backup round-trips arrangement, source audio, and instrument settings without overwriting identity', async () => {
  const song = composeSong(idea());
  const imported = await importProject(await exportProject(song));
  assert.notEqual(imported.id, song.id);
  assert.deepEqual(imported.sections, song.sections);
  assert.deepEqual(imported.tracks[0].events, song.tracks[0].events);
  assert.equal(await imported.tracks[0].original!.text(), 'my original');
  assert.equal(imported.context!.tempo, song.context!.tempo);
  await assert.rejects(
    importProject(
      new Blob(['{"format":"tapcomposer-project","version":1,"tracks":[]}']),
    ),
    /valid/,
  );
  const corrupted = JSON.parse(await (await exportProject(song)).text());
  corrupted.tracks[0].events[0].note = 100000;
  await assert.rejects(
    importProject(new Blob([JSON.stringify(corrupted)])),
    /invalid music/,
  );
});
void test('MIDI includes song tempo and every audible instrument track', async () => {
  const song = composeSong(idea()),
    data = new Uint8Array(await exportMidi(song).arrayBuffer());
  assert.equal(new TextDecoder().decode(data.slice(0, 4)), 'MThd');
  assert.equal(data[11], song.tracks.length + 1);
  let offset = 14,
    count = 0;
  while (offset < data.length) {
    assert.equal(
      new TextDecoder().decode(data.slice(offset, offset + 4)),
      'MTrk',
    );
    const size = new DataView(data.buffer).getUint32(offset + 4);
    assert.ok(size > 0);
    offset += 8 + size;
    count++;
  }
  assert.equal(count, song.tracks.length + 1);
  assert.equal(offset, data.length);
});
void test('undo and redo restore full arrangements and original audio by reference', () => {
  const first = idea(),
    second = composeSong(first);
  let state = {
    present: first as Song | null,
    past: [] as Song[],
    future: [] as Song[],
  };
  state = songHistoryReducer(state, { type: 'edit', song: second });
  state = songHistoryReducer(state, { type: 'undo' });
  assert.equal(state.present, first);
  state = songHistoryReducer(state, { type: 'redo' });
  assert.equal(state.present, second);
  assert.equal(state.present!.tracks[0].original, first.tracks[0].original);
});
void test('automatic main sections keep a long recorded phrase in full', () => {
  const song = idea();
  song.tracks[0].duration = 24;
  const beat = 60 / song.context!.tempo;
  song.tracks[0].events.push({
    time: 23,
    duration: 0.5,
    note: 72,
    velocity: 0.7,
  });
  const composed = composeSong(song);
  const main = composed.sections![1];
  assert.ok(main.bars * 4 * beat >= 24);
  const part = arrangedTracks(composed, main.id).find(
    (t) => t.id === 'my-idea',
  )!;
  assert.ok(part.events.some((e) => e.note === 72));
});
void test('regeneration changes backing rhythms while preserving the source melody', () => {
  const first = composeSong(idea()),
    second = composeSong(first, { variation: 1 });
  assert.deepEqual(first.tracks[0].events, second.tracks[0].events);
  const a = first.tracks.find((t) => t.instrument === 'guitar')!,
    b = second.tracks.find((t) => t.instrument === 'guitar')!;
  assert.notDeepEqual(
    a.events.map((e) => e.time),
    b.events.map((e) => e.time),
  );
});
void test('per-section entrances, one-time play, and register changes affect only the arranged output', () => {
  const song = composeSong(idea());
  const original = song.tracks[0];
  song.sections![1].parts = {
    [original.id]: { offsetBeats: 4, repeat: false, transpose: 12 },
  };
  const rendered = arrangedTracks(song, song.sections![1].id).find(
    (t) => t.id === original.id,
  )!;
  assert.equal(rendered.events.length, original.events.length);
  assert.ok(rendered.events[0].time >= (4 * 60) / song.context!.tempo);
  assert.equal(rendered.events[0].note, original.events[0].note + 12);
  assert.equal(original.events[0].note, 60);
});
