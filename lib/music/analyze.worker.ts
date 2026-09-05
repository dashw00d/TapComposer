import { analyzeHum, analyzeTaps } from './analyze';
self.onmessage = (
  event: MessageEvent<{
    pcm: Float32Array;
    sampleRate: number;
    source: string;
  }>,
) => {
  try {
    const { pcm, sampleRate, source } = event.data;
    self.postMessage({
      intent:
        source === 'hum'
          ? analyzeHum(pcm, sampleRate)
          : analyzeTaps(pcm, sampleRate),
    });
  } catch (e) {
    self.postMessage({
      error:
        e instanceof Error ? e.message : 'Could not understand that recording.',
    });
  }
};
