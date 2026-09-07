import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PremiumAnalysis,
  validVoiceIntent,
} from '../lib/music/premium-analysis';
import { resolveIntent } from '../lib/music/resolve';
import type { MusicalIntent } from '../lib/music/types';
const pcm = new Float32Array(16000);
const intent: MusicalIntent = {
  version: 1,
  source: 'hum',
  analyzer: 'rosvot-crepe',
  duration: 1,
  confidence: 0.9,
  events: [
    {
      time: 0.137,
      duration: 0.47,
      pitch: 60.1,
      intensity: 0.7,
      confidence: 0.9,
    },
  ],
};

void test('free and unavailable recognition never POST audio; taps stay local', async () => {
  for (const access of [
    { premium: false, transcriptionReady: true },
    { premium: true, transcriptionReady: false },
  ]) {
    const requests: string[] = [];
    let local = 0;
    const client = new PremiumAnalysis(
      (audio) => {
        assert.equal(audio, pcm);
        local++;
        return { result: Promise.resolve(intent), cancel() {} };
      },
      (async (url, init) => {
        assert.equal(init?.method, undefined);
        requests.push(
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.href
              : url.url,
        );
        return Response.json(access);
      }) as typeof fetch,
    );
    await client.analyze(pcm, 16000, 'hum').result;
    await client.analyze(pcm, 16000, 'microphone-taps').result;
    assert.equal(local, 2);
    assert.deepEqual(requests, ['/api/premium/status']);
  }
});
void test('premium sends WAV and preserves the returned capture clock', async () => {
  const client = new PremiumAnalysis(
    () => {
      throw new Error('Unexpected fallback');
    },
    (async (url, init) => {
      if (url === '/api/premium/status')
        return Response.json({ premium: true, transcriptionReady: true });
      assert.equal(url, '/api/premium/transcribe');
      assert.equal(init?.method, 'POST');
      assert.ok(init?.body instanceof Blob);
      const wav = new DataView(await init.body.arrayBuffer());
      assert.equal(wav.getUint32(24, true), 16000);
      assert.equal(wav.getUint32(40, true), 32000);
      return Response.json(intent);
    }) as typeof fetch,
  );
  const result = await client.analyze(pcm, 16000, 'hum').result;
  assert.deepEqual(result, intent);
  const context = { tempo: 120, key: 0, mode: 'major' as const, confidence: 1 };
  const natural = resolveIntent(result, 'piano', context, false, true);
  assert.equal(natural.events[0].time, 0.137);
  assert.notEqual(
    resolveIntent(result, 'piano', context, true, true).events[0].time,
    0.137,
  );
});
void test('invalid premium output falls back using intact source PCM', async () => {
  let calls = 0;
  const client = new PremiumAnalysis(
    (audio) => {
      assert.equal(audio, pcm);
      calls++;
      return { result: Promise.resolve(intent), cancel() {} };
    },
    (async (url) =>
      Response.json(
        url === '/api/premium/status'
          ? { premium: true, transcriptionReady: true }
          : { ...intent, duration: 8 },
      )) as typeof fetch,
  );
  assert.deepEqual(await client.analyze(pcm, 16000, 'hum').result, intent);
  assert.equal(calls, 1);
  assert.equal(
    validVoiceIntent(
      { ...intent, events: [{ ...intent.events[0], pitch: NaN }] },
      1,
    ),
    false,
  );
  assert.equal(
    validVoiceIntent(
      { ...intent, events: [{ ...intent.events[0], duration: 2 }] },
      1,
    ),
    false,
  );
});
void test('cancellation during access check or upload prevents fallback and late results', async () => {
  for (const stage of ['status', 'transcribe']) {
    let release: (r: Response) => void = () => {};
    let entered: () => void = () => {};
    const ready = new Promise<void>((r) => {
      entered = r;
    });
    const client = new PremiumAnalysis(
      () => {
        throw new Error('Cancelled tasks must not fall back');
      },
      (async (url) => {
        if (stage === 'transcribe' && url === '/api/premium/status')
          return Response.json({ premium: true, transcriptionReady: true });
        entered();
        return await new Promise<Response>((r) => {
          release = r;
        });
      }) as typeof fetch,
    );
    const task = client.analyze(pcm, 16000, 'hum');
    await ready;
    const rejected = assert.rejects(task.result, /Cancelled/);
    task.cancel();
    await rejected;
    release(
      Response.json(
        stage === 'status'
          ? { premium: true, transcriptionReady: true }
          : intent,
      ),
    );
    await new Promise((r) => setTimeout(r, 0));
  }
});

void test('choosing Free bypasses even the premium status request', async () => {
  let local = 0;
  const client = new PremiumAnalysis(
    () => {
      local++;
      return { result: Promise.resolve(intent), cancel() {} };
    },
    (async () => {
      throw new Error('Free mode must not contact inference');
    }) as typeof fetch,
    () => false,
  );
  await client.analyze(pcm, 16000, 'hum').result;
  assert.equal(local, 1);
});
