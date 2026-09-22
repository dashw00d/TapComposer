export type NoiseKind = 'hiss' | 'rumble';
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
export function syntheticNoise(
  length: number,
  rate: number,
  kind: NoiseKind,
  seed: number,
) {
  const random = seededRandom(seed);
  let low = 0;
  const smoothing = 1 - Math.exp((-2 * Math.PI * 180) / rate);
  return Float32Array.from({ length }, (_, i) => {
    const white = random() * 2 - 1;
    low += smoothing * (white - low);
    return kind === 'hiss'
      ? white
      : low * 3 + 0.1 * Math.sin((2 * Math.PI * 60 * i) / rate);
  });
}
/** Full-recording RMS SNR, including silence. Shared attenuation preserves the ratio. */
export function mixNoise(
  clean: Float32Array,
  noise: Float32Array,
  snrDb: number,
  offset = 0,
) {
  if (!noise.length || !clean.length || !Number.isFinite(snrDb))
    throw new Error('Need nonempty audio and a finite noise level.');
  let signalPower = 0,
    noisePower = 0;
  for (let i = 0; i < clean.length; i++) {
    signalPower += clean[i] ** 2;
    noisePower += noise[(i + offset) % noise.length] ** 2;
  }
  if (!signalPower || !noisePower)
    throw new Error('The voice or noise recording is silent.');
  const noiseScale = Math.sqrt(signalPower / noisePower / 10 ** (snrDb / 10));
  const mixed = Float32Array.from(
    clean,
    (sample, i) => sample + noise[(i + offset) % noise.length] * noiseScale,
  );
  let peak = 0;
  for (const sample of mixed) peak = Math.max(peak, Math.abs(sample));
  const gain = Math.min(1, 0.98 / Math.max(0.98, peak));
  for (let i = 0; i < mixed.length; i++) mixed[i] *= gain;
  return { pcm: mixed, noiseScale, gain, snrDb, offset };
}
