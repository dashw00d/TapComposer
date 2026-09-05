import type { IntentEvent, MusicalIntent, InputSource } from './types';

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
const median = (a: number[]) =>
  [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)] ?? 0;

/** YIN cumulative mean normalized difference. Reject unvoiced/noisy frames. */
export function detectPitch(
  frame: Float32Array,
  sampleRate: number,
): { pitch: number; confidence: number; rms: number } | null {
  let energy = 0,
    mean = 0;
  for (const x of frame) mean += x;
  mean /= frame.length;
  for (const x of frame) energy += (x - mean) ** 2;
  const rms = Math.sqrt(energy / frame.length);
  if (rms < 0.009) return null;
  const minTau = Math.floor(sampleRate / 1000),
    maxTau = Math.min(
      Math.floor(sampleRate / 70),
      Math.floor(frame.length / 2),
    );
  const diff = new Float32Array(maxTau + 1);
  let total = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < frame.length - maxTau; i++)
      sum += (frame[i] - frame[i + tau]) ** 2;
    total += sum;
    diff[tau] = total ? (sum * tau) / total : 1;
  }
  for (let tau = minTau; tau < maxTau - 1; tau++) {
    if (diff[tau] < 0.16) {
      while (tau + 1 < maxTau && diff[tau + 1] < diff[tau]) tau++;
      const a = diff[tau - 1],
        b = diff[tau],
        c = diff[tau + 1] ?? b;
      const offset =
        a + c - 2 * b ? clamp((a - c) / (2 * (a + c - 2 * b)), -0.5, 0.5) : 0;
      const hz = sampleRate / (tau + offset);
      return { pitch: 69 + 12 * Math.log2(hz / 440), confidence: 1 - b, rms };
    }
  }
  return null;
}

/** Average before decimation to reduce high-frequency aliasing. */
function downsample(
  pcm: Float32Array,
  rate: number,
): { pcm: Float32Array; rate: number } {
  const step = Math.max(1, Math.floor(rate / 8000));
  const output = new Float32Array(Math.floor(pcm.length / step));
  for (let i = 0; i < output.length; i++) {
    let sum = 0;
    for (let j = 0; j < step; j++) sum += pcm[i * step + j];
    output[i] = sum / step;
  }
  return { pcm: output, rate: rate / step };
}

export function analyzeHum(
  input: Float32Array,
  sampleRate: number,
): MusicalIntent {
  const { pcm, rate } = downsample(input, sampleRate);
  const frameSize = 512,
    hop = 128;
  const frames: {
    time: number;
    pitch: number;
    confidence: number;
    rms: number;
  }[] = [];
  for (let i = 0; i + frameSize <= pcm.length; i += hop) {
    const detected = detectPitch(pcm.subarray(i, i + frameSize), rate);
    frames.push({
      time: i / rate,
      pitch: detected?.pitch ?? NaN,
      confidence: detected?.confidence ?? 0,
      rms: detected?.rms ?? 0,
    });
  }
  const smoothed = frames.map((f, i) => {
    const neighbors = frames
      .slice(Math.max(0, i - 2), i + 3)
      .filter((x) => Number.isFinite(x.pitch));
    return {
      ...f,
      pitch:
        Number.isFinite(f.pitch) && neighbors.length >= 3
          ? median(neighbors.map((x) => x.pitch))
          : NaN,
    };
  });
  const events: IntentEvent[] = [];
  let group: typeof frames = [];
  const flush = () => {
    if (
      group.length >= 4 &&
      group[group.length - 1].time - group[0].time >= 0.048
    ) {
      events.push({
        time: group[0].time,
        duration: group[group.length - 1].time - group[0].time + hop / rate,
        pitch: median(group.map((x) => x.pitch)),
        confidence: group.reduce((s, x) => s + x.confidence, 0) / group.length,
        intensity: clamp(
          Math.sqrt(group.reduce((s, x) => s + x.rms, 0) / group.length) * 1.7,
          0.2,
          1,
        ),
      });
    }
    group = [];
  };
  for (const f of smoothed) {
    if (!Number.isFinite(f.pitch)) {
      if (group.length && f.time - group[group.length - 1].time > 0.064)
        flush();
      continue;
    }
    if (
      group.length &&
      (Math.abs(f.pitch - median(group.slice(-7).map((x) => x.pitch))) > 0.85 ||
        f.time - group[group.length - 1].time > 0.08)
    )
      flush();
    group.push(f);
  }
  flush();
  return buildIntent('hum', events, input.length / sampleRate);
}

export function analyzeTaps(
  pcm: Float32Array,
  sampleRate: number,
): MusicalIntent {
  const hop = Math.max(1, Math.round(sampleRate * 0.008));
  const envelopes: number[] = [];
  for (let i = 0; i + hop < pcm.length; i += hop) {
    let energy = 0;
    for (let j = i; j < i + hop; j++) energy += pcm[j] ** 2;
    envelopes.push(Math.sqrt(energy / hop));
  }
  const peak = Math.max(0.001, ...envelopes);
  const noise =
    [...envelopes].sort((a, b) => a - b)[Math.floor(envelopes.length * 0.35)] ??
    0;
  const threshold = Math.max(0.012, noise * 3.5, peak * 0.12);
  const events: IntentEvent[] = [];
  let last = -1;
  for (let i = 1; i < envelopes.length - 1; i++) {
    const time = (i * hop) / sampleRate;
    const before = envelopes.slice(Math.max(0, i - 5), i);
    const baseline = before.reduce((a, b) => a + b, 0) / before.length;
    if (
      envelopes[i] > threshold &&
      envelopes[i] > baseline * 1.65 &&
      envelopes[i] >= envelopes[i + 1] &&
      time - last > 0.12
    ) {
      events.push({
        time: Math.max(0, time - 0.008),
        duration: 0.1,
        pitch: null,
        confidence: 0.9,
        intensity: clamp(envelopes[i] / peak, 0.25, 1),
      });
      last = time;
    }
  }
  return buildIntent('microphone-taps', events, pcm.length / sampleRate);
}
export function buildIntent(
  source: InputSource,
  events: IntentEvent[],
  duration: number,
): MusicalIntent {
  return {
    version: 1,
    source,
    events,
    duration,
    confidence: events.length
      ? events.reduce((sum, e) => sum + e.confidence, 0) / events.length
      : 0,
  };
}
