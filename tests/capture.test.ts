import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

void test('capture worklet honors the song clock, flushes on release, and stops at 30 seconds', () => {
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
});
