import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisClient } from '../lib/music/analysis-client';
import { buildIntent } from '../lib/music/analyze';
class FakeWorker {
  messages: Record<string, unknown>[] = [];
  terminated = false;
  onmessage: ((event: { data: Record<string, unknown> }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage(data: Record<string, unknown>) {
    this.messages.push(data);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: Record<string, unknown>) {
    this.onmessage?.({ data });
  }
}
function setup() {
  const workers: FakeWorker[] = [];
  const client = new AnalysisClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return { client, workers };
}
void test('recognition prewarms and reuses its worker; progress does not end a take', async () => {
  const { client, workers } = setup();
  try {
    client.prepare();
    assert.equal(workers[0].messages[0].type, 'prepare');
    let progress = 0;
    const pcm = new Float32Array([0.1, 0.2]);
    const task = client.analyze(pcm, 16000, 'hum', (value) => {
      progress = value;
    });
    const message = workers[0].messages[1];
    assert.notEqual(message.pcm, pcm);
    workers[0].reply({ id: message.id, progress: 0.5 });
    assert.equal(progress, 0.5);
    const intent = buildIntent('hum', [], 1);
    workers[0].reply({ id: message.id, intent });
    assert.equal(await task.result, intent);
    const next = client.analyze(pcm, 16000, 'hum');
    assert.equal(workers.length, 1);
    const latest = workers[0].messages.at(-1)!;
    workers[0].reply({ id: latest.id, intent });
    await next.result;
  } finally {
    client.dispose();
  }
});
void test('worker errors retry source PCM once with quick recognition; cancellation stops computation', async () => {
  const { client, workers } = setup();
  try {
    const pcm = new Float32Array([0.3, 0.4]);
    const task = client.analyze(pcm, 16000, 'hum');
    workers[0].onerror?.();
    assert.ok(workers[0].terminated);
    assert.equal(workers.length, 2);
    const retry = workers[1].messages[0];
    assert.equal(retry.quick, true);
    assert.deepEqual(retry.pcm, pcm);
    workers[1].reply({ id: retry.id, intent: buildIntent('hum', [], 1) });
    await task.result;
    const cancelled = client.analyze(pcm, 16000, 'hum');
    cancelled.cancel();
    await assert.rejects(cancelled.result, /Cancelled/);
    assert.ok(workers[1].terminated);
  } finally {
    client.dispose();
  }
});
