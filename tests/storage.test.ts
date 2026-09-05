import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSongs, saveSong, safeFilename } from '../lib/music/storage';
import { newSong } from '../lib/music/types';

void test('songs and original recordings survive a database round trip', async () => {
  const song = newSong();
  song.tracks = [
    {
      id: 'p',
      instrument: 'piano',
      name: 'Piano 1',
      intent: {
        version: 1,
        source: 'hum',
        events: [],
        duration: 1,
        confidence: 0,
      },
      events: [],
      duration: 1,
      original: new Blob(['untouched input']),
      muted: false,
      smoother: false,
    },
  ];
  await saveSong(song);
  const saved = (await listSongs()).find((s) => s.id === song.id)!;
  assert.equal(await saved.tracks[0].original!.text(), 'untouched input');
  assert.equal(saved.id, song.id);
  song.name = 'Renamed song';
  await saveSong(song);
  assert.equal((await listSongs()).filter((s) => s.id === song.id).length, 1);
  assert.equal(
    (await listSongs()).find((s) => s.id === song.id)?.name,
    'Renamed song',
  );
});
void test('new songs preserve previous songs and list most recent first', async () => {
  const first = newSong(),
    second = newSong();
  first.updatedAt = 100;
  second.updatedAt = 200;
  await saveSong(first);
  await saveSong(second);
  const songs = await listSongs();
  assert.ok(
    songs.findIndex((s) => s.id === second.id) <
      songs.findIndex((s) => s.id === first.id),
  );
});
void test('download filenames retain Unicode names but remove path syntax', () => {
  assert.equal(safeFilename('../hello/song:idea?'), 'hellosongidea');
  assert.equal(safeFilename('音楽'), '音楽');
  assert.equal(safeFilename('???'), 'My little song');
});
