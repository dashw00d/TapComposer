import type { AudioEngine } from './audio';
import type { MusicalIntent } from './types';
import { encodeWav } from './wav';
import { analyzeRecording } from './analysis-client';

export interface CaptureSession {
  stop: () => void;
  cancel: () => void;
  startAt: number;
  currentTime: () => number;
}
export function alignCapturedIntent(
  intent: MusicalIntent,
  hasBacking: boolean,
): MusicalIntent {
  // Counted microphone takes retain the full timeline, including a deliberate
  // pause before the first note. Only a standalone tap-pad gesture starts on tap.
  if (intent.source !== 'touch' || hasBacking || !intent.events.length)
    return intent;
  const trim = intent.events[0].time;
  return {
    ...intent,
    events: intent.events.map((e) => ({
      ...e,
      time: Math.max(0, e.time - trim),
    })),
    duration: Math.max(0, intent.duration - trim),
  };
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
      echoCancellation: false,
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
    // Acquire the device and load the worklet before starting the count-in.
    // Round to a sample boundary shared by the worklet and backing transport.
    const startAt =
      Math.ceil((context.currentTime + 3.1) * context.sampleRate) /
      context.sampleRate;
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
        cancelled = true;
        cleanup();
        node?.port.close();
        onComplete(event.data.pcm, context.sampleRate);
      }
    };
    node.onprocessorerror = () => {
      cleanup();
      if (!cancelled) {
        cancelled = true;
        node?.port.close();
        onComplete(new Float32Array(), context.sampleRate);
      }
    };
    source.connect(node);
    node.connect(context.destination); // Worklet output is always silence.
    return {
      startAt,
      currentTime: () => context.currentTime,
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
