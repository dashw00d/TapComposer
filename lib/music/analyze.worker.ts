import { analyzeHum, analyzeTaps } from './analyze';
import type { InferenceSession } from 'onnxruntime-web/wasm';
let model: Promise<InferenceSession> | null = null;
function prepareModel() {
  model ??= (async () => {
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.initTimeout = 10000;
    ort.env.wasm.wasmPaths = new URL(
      '/inference/ort-1.29.0/',
      self.location.origin,
    ).href;
    const { CREPE_MODEL } = await import('./neural');
    const response = await fetch(CREPE_MODEL, {
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error('Model unavailable');
    return ort.InferenceSession.create(await response.arrayBuffer(), {
      executionProviders: ['wasm'],
    });
  })();
  return model;
}
self.onmessage = async (
  event: MessageEvent<{
    type?: 'prepare';
    id: number;
    pcm: Float32Array;
    sampleRate: number;
    source: string;
    quick?: boolean;
  }>,
) => {
  if (event.data.type === 'prepare') {
    try {
      await prepareModel();
    } catch {
      /* Capture remains available through the quick detector. */
    }
    return;
  }
  const { id, pcm, sampleRate, source, quick } = event.data;
  try {
    if (source !== 'hum') {
      self.postMessage({ id, intent: analyzeTaps(pcm, sampleRate) });
      return;
    }
    if (!quick) {
      try {
        const session = await prepareModel();
        const { neuralHum } = await import('./neural');
        const intent = await neuralHum(pcm, sampleRate, session, (progress) =>
          self.postMessage({ id, progress }),
        );
        self.postMessage({ id, intent });
        return;
      } catch {
        /* Unsupported devices, unavailable assets and slow inference use DSP. */
      }
    }
    self.postMessage({
      id,
      intent: { ...analyzeHum(pcm, sampleRate), analyzer: 'yin' },
    });
  } catch (e) {
    self.postMessage({
      id,
      error:
        e instanceof Error ? e.message : 'Could not understand that recording.',
    });
  }
};
