import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanHumIntent, stabilizeHum } from '../lib/music/phrase-cleanup';
import { resolveIntent, smoothTrack } from '../lib/music/resolve';
import { changeInstrument } from '../lib/music/composition';
import { noteEnvelope } from '../lib/music/articulation';
import type { IntentEvent, MusicalIntent, Track } from '../lib/music/types';
const context = { tempo: 120, key: 0, mode: 'major' as const, confidence: 1 };
const note = (
  time: number,
  duration: number,
  pitch = 60,
  confidence = 0.95,
  intensity = 0.7,
): IntentEvent => ({ time, duration, pitch, confidence, intensity });
const intent = (events: IntentEvent[]): MusicalIntent => ({
  version: 1,
  source: 'hum',
  duration: 5,
  confidence: 0.9,
  events,
});
function track(
  source: MusicalIntent,
  instrument: Track['instrument'] = 'piano',
): Track {
  return {
    id: 'a',
    name: 'Idea',
    instrument,
    intent: source,
    ...resolveIntent(source, instrument, context, false, true),
    smoother: false,
    original: new Blob(['source']),
    muted: false,
  };
}
void test('cleanup absorbs weak wobbles and octave blips inside one sustained note', () => {
  for (const pitch of [61, 72]) {
    const source = intent([
      note(0.2, 0.5),
      note(0.7, 0.07, pitch, 0.5, 0.3),
      note(0.77, 0.5),
    ]);
    const before = structuredClone(source);
    const cleaned = cleanHumIntent(source, context);
    assert.equal(cleaned.events.length, 1);
    assert.equal(cleaned.events[0].pitch, 60);
    assert.equal(cleaned.events[0].time, 0.2);
    assert.ok(Math.abs(stabilizeHum(source).events[0].duration - 1.07) < 1e-8);
    assert.equal(cleaned.events[0].duration, 1);
    assert.deepEqual(source, before);
  }
});
void test('stabilization preserves breaths and repeated syllables before fitting rhythm', () => {
  for (const events of [
    [note(0.2, 0.12), note(0.32, 0.12, 61), note(0.44, 0.12)],
    [note(0.2, 0.25), note(0.6, 0.25), note(1, 0.25)],
    [note(0.2, 0.5), note(0.8, 0.07, 61, 0.5, 0.3), note(1, 0.5)],
  ]) {
    const source = intent(events),
      cleaned = stabilizeHum(source);
    assert.deepEqual(
      cleaned.events.map((e) => [e.time, e.duration, e.pitch]),
      source.events.map((e) => [e.time, e.duration, e.pitch]),
    );
  }
});
void test('cleanup fits loose rhythm and durations to a consistent grid while retaining the first onset', () => {
  const source = intent(
    [0.137, 0.648, 1.13, 1.649, 2.132, 2.64].map((t) => note(t, 0.25)),
  );
  const cleaned = cleanHumIntent(source, context);
  assert.equal(cleaned.events[0].time, 0.137);
  let changed = false;
  cleaned.events.forEach((e, i) => {
    assert.ok(Math.abs(e.time - source.events[i].time) <= 0.018 + 1e-8);
    if (e.time !== source.events[i].time) changed = true;
  });
  assert.ok(changed);
  const loose = intent(
    [0.17, 0.581, 1.101, 1.402, 2.236, 2.813].map((t) => note(t, 0.15)),
  );
  const regular = cleanHumIntent(loose, context);
  for (const e of regular.events) {
    assert.ok(
      Math.abs((e.time - 0.17) / 0.25 - Math.round((e.time - 0.17) / 0.25)) <
        1e-8,
    );
    assert.ok(
      Math.abs(e.duration / 0.25 - Math.round(e.duration / 0.25)) < 1e-8,
    );
  }
  const triplets = intent(
    [0, 1, 2, 3, 4, 5].map((i) => note(0.2 + i / 6, 0.12)),
  );
  cleanHumIntent(triplets, context).events.forEach((e, i) =>
    assert.ok(Math.abs(e.time - triplets.events[i].time) < 1e-8),
  );
});
void test('short settling notes merge toward the sustained pitch even with high detector confidence', () => {
  for (const pitch of [60, 61, 62]) {
    for (const events of [
      [note(0, 0.07, pitch), note(0.07, 0.6, 60)],
      [note(0, 0.6, 60), note(0.6, 0.07, pitch)],
    ]) {
      const clean = cleanHumIntent(intent(events), context);
      assert.equal(clean.events.length, 1);
      assert.equal(clean.events[0].pitch, 60);
      assert.ok(clean.events[0].duration >= 0.5);
    }
  }
  const leap = intent([note(0, 0.08, 67), note(0.08, 0.6, 60)]);
  assert.equal(stabilizeHum(leap).events.length, 2);
});
void test('cleanup evens loudness without reversing accents and is exactly reversible across instruments', () => {
  const source = intent([
    note(0.2, 0.4, 60, 0.9, 0.2),
    note(0.8, 0.4, 61, 0.9, 0.9),
    note(1.4, 0.4, 64, 0.9, 0.6),
  ]);
  const initial = track(source),
    cleaned = smoothTrack(initial, context);
  assert.ok(cleaned.events[1].velocity > cleaned.events[2].velocity);
  assert.ok(
    cleaned.events[1].velocity - cleaned.events[0].velocity <
      initial.events[1].velocity - initial.events[0].velocity,
  );
  assert.deepEqual(smoothTrack(cleaned, context).events, initial.events);
  assert.equal(cleaned.intent, initial.intent);
  assert.equal(cleaned.original, initial.original);
  const strings = changeInstrument(cleaned, 'strings', context);
  assert.equal(strings.smoother, true);
  assert.deepEqual(
    smoothTrack(strings, context).events,
    resolveIntent(source, 'strings', context, false, true).events,
  );
});
void test('held hums are not cut off at eight seconds and polyphonic manual notes are untouched', () => {
  const held = intent([note(0, 14.1)]);
  const resolved = resolveIntent(held, 'strings', context, true, true);
  assert.equal(resolved.events[0].duration, 14);
  const chord = intent([note(0, 1), note(0, 1, 64), note(0, 1, 67)]);
  assert.equal(cleanHumIntent(chord, context), chord);
});

void test('phrase cleanup joins tiny holes but keeps audible rests and repeated attacks', () => {
  const source = intent([
    note(0.2, 0.46),
    note(0.71, 0.34),
    note(1.21, 0.26, 64),
    note(2.22, 0.4, 67),
  ]);
  const original = structuredClone(source);
  const clean = cleanHumIntent(source, context);
  assert.equal(clean.events.length, 4);
  const gaps = clean.events
    .slice(1)
    .map((e, i) => e.time - clean.events[i].time - clean.events[i].duration);
  assert.ok(Math.abs(gaps[0]) < 1e-8, 'tiny break joins at next attack');
  assert.ok(Math.abs(gaps[1] - 0.25) < 1e-8, 'breath becomes an eighth rest');
  assert.ok(Math.abs(gaps[2] - 0.75) < 1e-8, 'longer pause retains its space');
  assert.equal(clean.events[0].time, source.events[0].time);
  assert.deepEqual(source, original);
});

void test('cleaned phrases shorten release tails without cutting intentional overlaps', () => {
  const t = {
    ...track(intent([note(0, 0.4), note(0.4, 0.4, 64)]), 'strings'),
    smoother: true,
  };
  t.events = [
    { time: 0, duration: 0.4, note: 60, velocity: 0.7 },
    { time: 0.4, duration: 0.4, note: 64, velocity: 0.7 },
  ];
  const envelope = noteEnvelope(t, 0, 0.5);
  assert.ok(envelope.release < 0.05);
  assert.ok(envelope.attack <= 0.055);
  assert.equal(noteEnvelope({ ...t, smoother: false }, 0, 0.5).release, 0.5);
  assert.equal(
    noteEnvelope(
      { ...t, events: [t.events[0], { ...t.events[1], time: 0.1 }] },
      0,
      0.5,
    ).release,
    0.5,
  );
});
