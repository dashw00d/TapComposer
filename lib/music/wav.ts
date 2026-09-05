export function encodeWav(channels: Float32Array[], rate: number): Blob {
  const length = channels[0]?.length ?? 0;
  const data = new ArrayBuffer(44 + length * channels.length * 2);
  const view = new DataView(data);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, data.byteLength - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, length * channels.length * 2, true);
  let offset = 44;
  for (let i = 0; i < length; i++)
    for (const channel of channels) {
      const n = Math.max(-1, Math.min(1, channel[i]));
      view.setInt16(offset, Math.round(n * (n < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  return new Blob([data], { type: 'audio/wav' });
}
