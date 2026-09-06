import type { AudioEngine } from './audio';
import type { MusicalIntent } from './types';
import { encodeWav } from './wav';
import { analyzeRecording } from './analysis-client';

export interface CaptureSession {
  stop: () => void;
  cancel: () => void;
  startAt: number;
}
export async function beginCapture(
  engine: AudioEngine,
  onMeter: (level: number, elapsed: number) => void,
  onComplete: (pcm: Float32Array, rate: number) => void,
): Promise<CaptureSession> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      'Recording needs a secure browser connection. Open this app on HTTPS or localhost.',
    );
  const context = await engine.prepareCapture();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  let source: MediaStreamAudioSourceNode | null = null,
    node: AudioWorkletNode | null = null;
  let cancelled = false;
  const cleanup = () => {
    stream.getTracks().forEach((t) => t.stop());
    source?.disconnect();
    node?.disconnect();
  };
  try {
    const startAt = context.currentTime + 0.15;
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, 'tap-capture', {
      processorOptions: { startAt },
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.port.onmessage = (event) => {
      if (cancelled) return;
      if (event.data.type === 'meter')
        onMeter(event.data.level, event.data.elapsed);
      if (event.data.type === 'complete') {
        cleanup();
        onComplete(event.data.pcm, context.sampleRate);
      }
    };
    node.onprocessorerror = () => {
      cleanup();
      if (!cancelled) onComplete(new Float32Array(), context.sampleRate);
    };
    source.connect(node);
    node.connect(context.destination); // Worklet output is always silence.
    return {
      startAt,
      stop: () => node?.port.postMessage('stop'),
      cancel: () => {
        cancelled = true;
        cleanup();
        node?.port.close();
      },
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
export function understandRecording(
  pcm: Float32Array,
  sampleRate: number,
  source: 'hum' | 'microphone-taps',
  onProgress?: (value: number) => void,
): { original: Blob; result: Promise<MusicalIntent>; cancel: () => void } {
  const original = encodeWav([pcm], sampleRate);
  return { original, ...analyzeRecording(pcm, sampleRate, source, onProgress) };
}
export function microphoneError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError')
      return 'Microphone access is off. Allow it in your browser’s site settings, then try again. You can still use the drum pad.';
    if (error.name === 'NotFoundError')
      return 'No microphone was found. Connect one, or try the drum pad.';
    if (error.name === 'NotReadableError')
      return 'Your microphone is busy. Close other apps using it and try again.';
  }
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}
