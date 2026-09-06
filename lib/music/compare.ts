import { encodeWav } from './wav';
/** Match average energy by attenuation only, preserving dynamics and preventing new clipping. */
export function comparisonLevels(
  buffers: Pick<AudioBuffer, 'numberOfChannels' | 'getChannelData'>[],
): number[] {
  const rms = buffers.map((buffer) => {
    let sum = 0,
      count = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++)
      for (const value of buffer.getChannelData(c)) {
        sum += value * value;
        count++;
      }
    return Math.sqrt(sum / Math.max(1, count));
  });
  const audible = rms.filter((v) => v > 1e-5);
  const target = audible.length ? Math.min(...audible) : 0;
  return rms.map((level) => (level > 1e-5 ? Math.min(1, target / level) : 1));
}
export function comparisonWav(buffer: AudioBuffer, gain: number): Blob {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i).map((v) => v * gain),
  );
  return encodeWav(channels, buffer.sampleRate);
}
export function comparisonSeek(seconds: number, duration: number): number {
  return Math.max(0, Math.min(seconds, Math.max(0, duration - 0.05)));
}
