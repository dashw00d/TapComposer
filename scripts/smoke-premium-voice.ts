/** Optional local end-to-end smoke test using public corpus audio, never user takes. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readVoiceWav } from './voice-audio';
import { PremiumAnalysis } from '../lib/music/premium-analysis';
import { resolveIntent } from '../lib/music/resolve';
import { noteScore } from './voice-metrics';
const request: typeof fetch = (url, init) =>
  fetch(
    new URL(
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      'http://localhost:3000',
    ),
    init,
  );
const client = new PremiumAnalysis(
  () => {
    throw new Error('Premium unavailable: browser fallback reached');
  },
  request,
  () => true,
);
const { pcm, rate } = readVoiceWav(
  await readFile('outputs/voice-benchmark/Audio/vocadito_17.wav'),
);
const start = performance.now();
const first = await client.analyze(pcm, rate, 'hum').result;
const seconds = (performance.now() - start) / 1000;
const second = await client.analyze(pcm, rate, 'hum').result;
assert.equal(first.analyzer, 'rosvot-crepe');
assert.deepEqual(first, second, 'Repeated inference must not change the notes');
assert.ok(first.events.length > 20);
const performanceNotes = resolveIntent(
  first,
  'piano',
  { tempo: 120, key: 0, mode: 'major', confidence: 1 },
  false,
  true,
);
assert.deepEqual(
  performanceNotes.events.map((e) => e.time),
  first.events.map((e) => e.time),
);
const quiet = await client.analyze(
  pcm.map((value) => value * 0.025),
  rate,
  'hum',
).result;
const reference = first.events.map((e) => ({
  time: e.time,
  duration: e.duration,
  pitch: Math.round(e.pitch!),
}));
const recovered = quiet.events.map((e) => ({
  time: e.time,
  duration: e.duration,
  pitch: Math.round(e.pitch!),
}));
const quietConsistency = noteScore(reference, recovered).f1;
assert.ok(
  quietConsistency > 0.85,
  'A quieter copy should recover substantially the same phrase',
);
const invalid = await request('/api/premium/transcribe', {
  method: 'POST',
  headers: { 'Content-Type': 'audio/wav' },
  body: 'not WAV',
});
assert.equal(invalid.status, 400);
const unauthenticated = await fetch('http://127.0.0.1:8790/transcribe', {
  method: 'POST',
  headers: { 'Content-Type': 'audio/wav' },
  body: 'not WAV',
});
assert.equal(unauthenticated.status, 401);
console.log({
  analyzer: first.analyzer,
  notes: first.events.length,
  seconds,
  repeatable: true,
  quietNotes: quiet.events.length,
  quietConsistency,
  timingPreserved: true,
  invalidWav: invalid.status,
  unauthenticated: unauthenticated.status,
});
