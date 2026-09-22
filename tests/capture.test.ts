import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

void test('capture worklet honors the song clock, flushes on stop, and stops at 30 seconds', () => {
  type Packet = {
    type: string;
    pcm?: Float32Array;
    level?: number;
    elapsed?: number;
  };
  type Processor = {
    process: (input: Float32Array[][]) => boolean;
    port: { onmessage: (event: { data: string }) => void };
  };
  let ProcessorClass: new (options: unknown) => Processor;
  const packets: Packet[] = [];
  const context = vm.createContext({
    AudioWorkletProcessor: class {
      port = { postMessage: (packet: Packet) => packets.push(packet) };
    },
    sampleRate: 8000,
    currentTime: 0,
    registerProcessor: (_name: string, ctor: typeof ProcessorClass) => {
      ProcessorClass = ctor;
    },
    Float32Array,
    Math,
  });
  vm.runInContext(
    readFileSync(
      new URL('../public/worklets/capture.js', import.meta.url),
      'utf8',
    ),
    context,
  );
  const processor = new ProcessorClass!({
    processorOptions: { startAt: 0.016 },
  });
  processor.process([[new Float32Array(128).fill(0.2)]]);
  assert.equal(packets.length, 0);
  context.currentTime = 0.016;
  processor.process([[new Float32Array(128).fill(0.3)]]);
  processor.port.onmessage({ data: 'stop' });
  assert.equal(packets.at(-1)?.type, 'complete');
  assert.equal(packets.at(-1)?.pcm?.length, 128);
  assert.ok(Math.abs(packets.at(-1)!.pcm![0] - 0.3) < 0.00001);
  processor.port.onmessage({ data: 'stop' });
  assert.equal(packets.filter((p) => p.type === 'complete').length, 1);
  const limit = new ProcessorClass!({ processorOptions: { startAt: 0 } });
  for (let i = 0; i < 2000; i++) {
    context.currentTime = i * 0.016;
    if (!limit.process([[new Float32Array(128)]])) break;
  }
  assert.equal(packets.at(-1)?.pcm?.length, 240000);
  // A start inside a render quantum excludes every pre-countdown sample.
  packets.length = 0;
  context.currentTime = 0;
  const fractional = new ProcessorClass!({
    processorOptions: { startAt: 64 / 8000 },
  });
  fractional.process([[Float32Array.from({ length: 128 }, (_, i) => i)]]);
  fractional.port.onmessage({ data: 'stop' });
  assert.equal(packets.at(-1)!.pcm!.length, 64);
  assert.equal(packets.at(-1)!.pcm![0], 64);

  // Device input can be absent during startup: preserve that gap on the clock.
  packets.length = 0;
  const gaps = new ProcessorClass!({ processorOptions: { startAt: 0 } });
  gaps.process([]);
  context.currentTime = 128 / 8000;
  gaps.process([[new Float32Array(128).fill(0.4)]]);
  context.currentTime = 256 / 8000;
  gaps.process([]);
  context.currentTime = 384 / 8000;
  gaps.process([[new Float32Array(128).fill(0.6)]]);
  gaps.port.onmessage({ data: 'stop' });
  const pcm = packets.at(-1)!.pcm!;
  assert.equal(pcm.length, 512);
  assert.ok(pcm.slice(0, 128).every((v) => v === 0));
  assert.ok(Math.abs(pcm[128] - 0.4) < 0.00001);
  assert.ok(pcm.slice(256, 384).every((v) => v === 0));
  assert.ok(Math.abs(pcm[384] - 0.6) < 0.00001);
});

void test('standalone ideas trim empty edges while backed takes preserve the recording clock', async () => {
  const { alignCapturedIntent } = await import('../lib/music/capture');
  const { buildIntent } = await import('../lib/music/analyze');
  for (const source of ['hum', 'microphone-taps'] as const) {
    const intent = buildIntent(
      source,
      [
        {
          time: 1.2,
          duration: 0.4,
          pitch: source === 'hum' ? 60 : null,
          confidence: 1,
          intensity: 0.8,
        },
      ],
      3,
    );
    for (const hasBacking of [false, true]) {
      const aligned = alignCapturedIntent(intent, hasBacking);
      assert.equal(aligned.events[0].time, hasBacking ? 1.2 : 0);
      assert.ok(Math.abs(aligned.duration - (hasBacking ? 3 : 0.4)) < 1e-8);
      assert.equal(intent.events[0].time, 1.2);
    }
  }
  const taps = buildIntent(
    'touch',
    [{ time: 0.02, duration: 0.1, pitch: null, confidence: 1, intensity: 0.8 }],
    2,
  );
  assert.equal(alignCapturedIntent(taps, false).events[0].time, 0);
  assert.equal(alignCapturedIntent(taps, true).events[0].time, 0.02);
});
