import type { IntentEvent, MusicalIntent, InputSource } from './types';

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
const median = (a: number[]) =>
  [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)] ?? 0;

function frameLevel(frame: Float32Array): number {
  let mean = 0,
    energy = 0;
  for (const x of frame) mean += x;
  mean /= frame.length;
  for (const x of frame) energy += (x - mean) ** 2;
  return Math.sqrt(energy / frame.length);
}

/** YIN cumulative mean normalized difference. Reject unvoiced/noisy frames. */
export function detectPitch(
  frame: Float32Array,
  sampleRate: number,
): { pitch: number; confidence: number; rms: number } | null {
  const rms = frameLevel(frame);
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
  // Match the neural path's centered audio clock, including the take's edges.
  const frame = new Float32Array(frameSize);
  for (let i = 0; i < pcm.length; i += hop) {
    for (let j = 0; j < frameSize; j++)
      frame[j] = pcm[i + j - frameSize / 2] ?? 0;
    const detected = detectPitch(frame, rate);
    frames.push({
      time: i / rate,
      pitch: detected?.pitch ?? NaN,
      confidence: detected?.confidence ?? 0,
      rms: detected?.rms ?? frameLevel(frame),
    });
  }
  return humFramesToIntent(frames, hop / rate, input.length / sampleRate);
}

export interface PitchFrame {
  time: number;
  pitch: number;
  confidence: number;
  rms: number;
}
export function humFramesToIntent(
  frames: PitchFrame[],
  hopSeconds: number,
  duration: number,
): MusicalIntent {
  // A deep local energy valley is a syllable boundary even when the tracker
  // can still hear the preceding pitch. Relative levels also work for quiet voices.
  const gated = frames.map((f, i) => {
    const nearby = frames.slice(Math.max(0, i - 8), i + 9);
    const level = median(nearby.map((x) => x.rms));
    return {
      ...f,
      pitch: f.rms < Math.max(0.001, level * 0.22) ? NaN : f.pitch,
    };
  });
  const smoothed = gated.map((f, i) => {
    const neighbors = gated
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
  // Bridge a short loss of pitch only when the voice continues at a healthy
  // level and returns to the same note. A breath or a long gap stays a rest.
  for (let i = 1; i < smoothed.length - 1; i++) {
    if (Number.isFinite(smoothed[i].pitch)) continue;
    const start = i;
    while (i < smoothed.length && !Number.isFinite(smoothed[i].pitch)) i++;
    const before = smoothed[start - 1],
      after = smoothed[i];
    if (
      !after ||
      !Number.isFinite(before.pitch) ||
      (i - start) * hopSeconds > 0.16 ||
      Math.abs(after.pitch - before.pitch) > 0.65
    )
      continue;
    const floor = Math.max(0.001, Math.min(before.rms, after.rms) * 0.25);
    if (
      smoothed.slice(start, i).some((f) => f.rms < floor || f.confidence < 0.15)
    )
      continue;
    for (let j = start; j < i; j++)
      smoothed[j] = {
        ...smoothed[j],
        pitch: (before.pitch + after.pitch) / 2,
        confidence: Math.min(before.confidence, after.confidence) * 0.8,
      };
  }
  const events: IntentEvent[] = [];
  let group: PitchFrame[] = [],
    pending: PitchFrame[] = [];
  const baseline = () => median(group.slice(-25).map((f) => f.pitch));
  const absorb = () => {
    const pitch = baseline();
    group.push(...pending.map((f) => ({ ...f, pitch })));
    pending = [];
  };
  const flush = () => {
    if (group.length * hopSeconds >= 0.06) {
      events.push({
        time: group[0].time,
        duration: Math.min(
          duration - group[0].time,
          group[group.length - 1].time - group[0].time + hopSeconds,
        ),
        pitch: median(group.map((x) => x.pitch)),
        confidence:
          group.reduce((sum, x) => sum + x.confidence, 0) / group.length,
        intensity: clamp(
          Math.sqrt(group.reduce((sum, x) => sum + x.rms, 0) / group.length) *
            1.7,
          0.2,
          1,
        ),
      });
    }
    group = [];
  };
  for (const f of smoothed) {
    if (!Number.isFinite(f.pitch)) {
      if (pending.length) absorb();
      if (group.length && f.time - group[group.length - 1].time >= 0.04 - 1e-8)
        flush();
      continue;
    }
    if (!group.length) {
      group.push(f);
      continue;
    }
    if (f.time - (pending.at(-1) ?? group.at(-1)!).time > 0.08) {
      absorb();
      flush();
      group.push(f);
      continue;
    }
    if (Math.abs(f.pitch - baseline()) <= 0.8) {
      absorb();
      group.push(f);
      continue;
    }
    if (
      pending.length &&
      Math.abs(f.pitch - median(pending.map((x) => x.pitch))) > 0.6
    )
      absorb();
    pending.push(f);
    // Confirm a new pitch over several frames, but retain its original onset.
    if (pending.at(-1)!.time - pending[0].time + hopSeconds >= 0.08 - 1e-8) {
      flush();
      group = pending;
      pending = [];
    }
  }
  if (pending.length) absorb();
  flush();
  return buildIntent('hum', events, duration);
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
