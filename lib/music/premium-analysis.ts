import type { MusicalIntent } from './types';
import { encodeWav } from './wav';

type AnalysisTask = { result: Promise<MusicalIntent>; cancel: () => void };
type LocalAnalysis = (
  pcm: Float32Array,
  sampleRate: number,
  source: 'hum' | 'microphone-taps',
  onProgress?: (value: number) => void,
) => AnalysisTask;

/** An explicit server entitlement gates audio upload; free recognition stays in-browser. */
export class PremiumAnalysis {
  private active: (() => void) | null = null;
  constructor(
    private local: LocalAnalysis,
    private request: typeof fetch = fetch,
    private enabled = () => {
      try {
        return localStorage.getItem('tapcomposer-service') !== 'free';
      } catch {
        return true;
      }
    },
  ) {}

  analyze: LocalAnalysis = (pcm, sampleRate, source, onProgress) => {
    this.active?.();
    if (source !== 'hum' || !this.enabled()) {
      const task = this.local(pcm, sampleRate, source, onProgress);
      this.active = task.cancel;
      return task;
    }
    const controller = new AbortController();
    let fallback: AnalysisTask | undefined;
    let completed = false;
    let rejectTask: (error: Error) => void = () => {};
    const cancel = () => {
      if (completed) return;
      controller.abort();
      fallback?.cancel();
      rejectTask(new Error('Cancelled'));
    };
    this.active = cancel;
    const result = new Promise<MusicalIntent>((resolve, reject) => {
      rejectTask = reject;
      void (async () => {
        try {
          const status = await this.request('/api/premium/status', {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(2000),
            ]),
          });
          const access = await status.json();
          if (controller.signal.aborted) return;
          if (
            this.enabled() &&
            status.ok &&
            access.premium === true &&
            access.transcriptionReady === true
          ) {
            onProgress?.(0.1);
            const response = await this.request('/api/premium/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'audio/wav' },
              body: encodeWav([pcm], sampleRate),
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(20000),
              ]),
            });
            const intent: unknown = await response.json();
            if (controller.signal.aborted) return;
            if (
              response.ok &&
              validVoiceIntent(intent, pcm.length / sampleRate)
            ) {
              onProgress?.(1);
              resolve(intent);
              return;
            }
          }
        } catch {
          // Failed/absent premium recognition uses the original PCM and local worker.
        }
        if (controller.signal.aborted) return;
        fallback = this.local(pcm, sampleRate, source, onProgress);
        resolve(await fallback.result);
      })().catch(reject);
    }).finally(() => {
      completed = true;
      if (this.active === cancel) this.active = null;
    });
    return { result, cancel };
  };
}

export function validVoiceIntent(
  value: unknown,
  duration: number,
): value is MusicalIntent {
  if (!value || typeof value !== 'object') return false;
  const v = value as MusicalIntent;
  const number = (n: unknown, min: number, max: number) =>
    typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  if (
    v.version !== 1 ||
    v.source !== 'hum' ||
    v.analyzer !== 'rosvot-crepe' ||
    !number(v.duration, duration - 0.002, duration + 0.002) ||
    !number(v.confidence, 0, 1) ||
    !Array.isArray(v.events) ||
    v.events.length > 600
  )
    return false;
  return v.events.every(
    (e, i) =>
      e &&
      number(e.time, 0, duration) &&
      number(e.duration, 0.001, duration) &&
      e.time + e.duration <= duration + 0.002 &&
      number(e.pitch, 20, 110) &&
      number(e.confidence, 0, 1) &&
      number(e.intensity, 0, 1) &&
      (i === 0 ||
        e.time >= v.events[i - 1].time + v.events[i - 1].duration - 0.002),
  );
}
