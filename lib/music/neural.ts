import { Tensor, type InferenceSession } from 'onnxruntime-web/wasm';
import { humFramesToIntent, type PitchFrame } from './analyze';

export const CREPE_MODEL = '/models/crepe-tiny-91fc2a0f.onnx';
const RATE = 16000,
  WINDOW = 1024,
  HOP = 320,
  BATCH = 32;
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/** Band-limited resampling before the model's built-in frame normalization. */
export function resampleVoice(input: Float32Array, rate: number): Float32Array {
  if (
    !Number.isFinite(rate) ||
    rate < 8000 ||
    rate > 192000 ||
    input.length / rate > 31
  )
    throw new Error('Unsupported recording format.');
  const output = new Float32Array(Math.floor((input.length * RATE) / rate));
  const cutoff = Math.min(1, RATE / rate) * 0.9,
    radius = 16;
  for (let i = 0; i < output.length; i++) {
    const position = (i * rate) / RATE,
      middle = Math.floor(position);
    let sum = 0,
      weight = 0;
    for (let tap = middle - radius + 1; tap <= middle + radius; tap++) {
      if (tap < 0 || tap >= input.length) continue;
      const distance = position - tap;
      const sinc =
        Math.abs(distance) < 1e-8
          ? cutoff
          : Math.sin(Math.PI * cutoff * distance) / (Math.PI * distance);
      const window = 0.5 + 0.5 * Math.cos((Math.PI * distance) / radius);
      const w = sinc * window;
      sum += (Number.isFinite(input[tap]) ? input[tap] : 0) * w;
      weight += w;
    }
    output[i] = weight ? sum / weight : 0;
  }
  return output;
}

export function decodeCrepe(
  probabilities: Float32Array,
  rms: number,
  previous?: number,
): { pitch: number; confidence: number } {
  if (rms < 0.003) return { pitch: NaN, confidence: 0 };
  // 65–1000 Hz covers ordinary humming and avoids unrelated sub-bass bins.
  let best = 62,
    bestScore = -Infinity;
  for (let bin = 62; bin <= 299; bin++) {
    const pitch =
      69 +
      12 *
        Math.log2((10 * 2 ** ((bin * 20 + 1997.3794084376191) / 1200)) / 440);
    const continuity =
      previous === undefined
        ? 0
        : Math.min(12, Math.abs(pitch - previous)) * 0.008;
    const score = probabilities[bin] - continuity;
    if (score > bestScore) {
      bestScore = score;
      best = bin;
    }
  }
  const confidence = probabilities[best];
  if (confidence < 0.55) return { pitch: NaN, confidence };
  let total = 0,
    weighted = 0;
  for (let bin = Math.max(0, best - 4); bin <= Math.min(359, best + 4); bin++) {
    total += probabilities[bin];
    weighted += bin * probabilities[bin];
  }
  const hz =
    10 *
    2 **
      (((weighted / Math.max(total, 1e-8)) * 20 + 1997.3794084376191) / 1200);
  return { pitch: 69 + 12 * Math.log2(hz / 440), confidence };
}

export async function neuralPitchFrames(
  input: Float32Array,
  sampleRate: number,
  session: InferenceSession,
  progress: (value: number) => void = () => {},
  budgetMs = 14000,
) {
  const pcm = resampleVoice(input, sampleRate),
    count = Math.ceil(pcm.length / HOP);
  const frames: PitchFrame[] = [];
  const deadline = performance.now() + budgetMs;
  let previous: number | undefined;
  for (let start = 0; start < count; start += BATCH) {
    if (performance.now() > deadline)
      throw new Error('Recognition budget exceeded');
    const n = Math.min(BATCH, count - start),
      data = new Float32Array(n * WINDOW),
      levels: number[] = [];
    for (let row = 0; row < n; row++) {
      let energy = 0,
        mean = 0;
      for (let j = 0; j < WINDOW; j++) {
        const at = (start + row) * HOP + j - WINDOW / 2;
        const value = pcm[at] ?? 0;
        data[row * WINDOW + j] = value;
        mean += value;
        energy += value * value;
      }
      levels.push(
        Math.sqrt(Math.max(0, energy / WINDOW - (mean / WINDOW) ** 2)),
      );
    }
    // The exported model includes z-score normalization; use raw PCM here.
    const tensor = new Tensor('float32', data, [n, WINDOW]);
    const output = await session.run({ frames: tensor });
    try {
      const probabilities = output.probabilities.data as Float32Array;
      for (let row = 0; row < n; row++) {
        const decoded = decodeCrepe(
          probabilities.subarray(row * 360, (row + 1) * 360),
          levels[row],
          previous,
        );
        previous = Number.isFinite(decoded.pitch) ? decoded.pitch : undefined;
        frames.push({
          time: ((start + row) * HOP) / RATE,
          ...decoded,
          rms: levels[row],
        });
      }
    } finally {
      tensor.dispose();
      for (const value of Object.values(output)) value.dispose();
    }
    progress(clamp((start + n) / count, 0, 1));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return frames;
}

export async function neuralHum(
  input: Float32Array,
  sampleRate: number,
  session: InferenceSession,
  progress: (value: number) => void = () => {},
  budgetMs = 14000,
) {
  const frames = await neuralPitchFrames(
    input,
    sampleRate,
    session,
    progress,
    budgetMs,
  );
  return {
    ...humFramesToIntent(frames, HOP / RATE, input.length / sampleRate),
    analyzer: 'crepe-tiny' as const,
  };
}
