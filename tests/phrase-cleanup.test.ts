import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanHumIntent } from '../lib/music/phrase-cleanup';
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
    assert.ok(Math.abs(cleaned.events[0].duration - 1.07) < 1e-8);
    assert.deepEqual(source, before);
  }
});
void test('cleanup preserves deliberate short chromatic notes, breaths and repeated syllables', () => {
  for (const events of [
    [note(0.2, 0.3), note(0.5, 0.07, 61), note(0.57, 0.3)],
    [note(0.2, 0.25), note(0.6, 0.25), note(1, 0.25)],
    [note(0.2, 0.5), note(0.8, 0.07, 61, 0.5, 0.3), note(1, 0.5)],
  ]) {
    const source = intent(events),
      cleaned = cleanHumIntent(source, context);
    assert.deepEqual(
      cleaned.events.map((e) => [e.time, e.duration, e.pitch]),
      source.events.map((e) => [e.time, e.duration, e.pitch]),
    );
  }
});
void test('cleanup follows established pulse gently, retains count-in and ignores irregular rhythm', () => {
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
  assert.deepEqual(
    cleanHumIntent(loose, context).events.map((e) => e.time),
    loose.events.map((e) => e.time),
  );
  const triplets = intent(
    [0, 1, 2, 3, 4, 5].map((i) => note(0.2 + i / 6, 0.12)),
  );
  assert.deepEqual(
    cleanHumIntent(triplets, context).events.map((e) => e.time),
    triplets.events.map((e) => e.time),
  );
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
