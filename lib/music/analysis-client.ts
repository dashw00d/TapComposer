import type { MusicalIntent } from './types';

// Keep the model warm between takes. Cancellation terminates actual computation.
export class AnalysisClient {
  private worker: Worker | null = null;
  private serial = 0;
  private cancelActive: (() => void) | null = null;
  private idle: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private createWorker = () =>
      new Worker(new URL('./analyze.worker.ts', import.meta.url), {
        type: 'module',
      }),
  ) {}
  private getWorker() {
    this.worker ??= this.createWorker();
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.dispose(), 180000);
    return this.worker;
  }
  prepare() {
    this.getWorker().postMessage({ type: 'prepare' });
  }
  dispose() {
    this.cancelActive?.();
    this.worker?.terminate();
    this.worker = null;
    clearTimeout(this.idle);
  }
  analyze(
    pcm: Float32Array,
    sampleRate: number,
    source: 'hum' | 'microphone-taps',
    onProgress?: (value: number) => void,
  ) {
    this.cancelActive?.();
    const id = ++this.serial;
    let rejectTask: (error: Error) => void = () => {};
    let timer: ReturnType<typeof setTimeout>;
    let completed = false;
    const finish = () => {
      completed = true;
      clearTimeout(timer);
      this.cancelActive = null;
    };
    const result = new Promise<MusicalIntent>((resolve, reject) => {
      rejectTask = reject;
      const run = (quick: boolean) => {
        const worker = this.getWorker();
        const fail = () => {
          if (completed) return;
          clearTimeout(timer);
          worker.terminate();
          this.worker = null;
          if (!quick) run(true);
          else {
            finish();
            reject(
              new Error(
                'That recording could not be understood. Please try again.',
              ),
            );
          }
        };
        worker.onmessage = (event) => {
          if (completed || event.data.id !== id) return;
          if (typeof event.data.progress === 'number') {
            onProgress?.(event.data.progress);
            return;
          }
          if (event.data.error) {
            fail();
            return;
          }
          finish();
          resolve(event.data.intent);
        };
        worker.onerror = fail;
        timer = setTimeout(fail, quick ? 5000 : 22000);
        // Retain source PCM for a bounded fallback after a worker crash or timeout.
        const copy = pcm.slice();
        worker.postMessage({ id, pcm: copy, sampleRate, source, quick }, [
          copy.buffer,
        ]);
      };
      run(false);
    });
    const cancel = () => {
      if (completed) return;
      finish();
      this.worker?.terminate();
      this.worker = null;
      rejectTask(new Error('Cancelled'));
    };
    this.cancelActive = cancel;
    return { result, cancel };
  }
}
const analyzer = new AnalysisClient();
export function prepareUnderstanding() {
  if (typeof Worker !== 'undefined') analyzer.prepare();
}
export const analyzeRecording = analyzer.analyze.bind(analyzer);
