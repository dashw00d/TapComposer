export function readVoiceWav(bytes: Buffer) {
  if (
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new Error('Expected WAV');
  let rate = 0,
    channels = 0,
    bits = 0,
    format = 0,
    data: Buffer | undefined;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(at + 4),
      kind = bytes.toString('ascii', at, at + 4);
    if (at + 8 + size > bytes.length) throw new Error('Truncated WAV chunk');
    if (kind === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV format chunk');
      format = bytes.readUInt16LE(at + 8);
      channels = bytes.readUInt16LE(at + 10);
      rate = bytes.readUInt32LE(at + 12);
      bits = bytes.readUInt16LE(at + 22);
    }
    if (kind === 'data') data = bytes.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  if (
    !data ||
    data.length % 2 !== 0 ||
    format !== 1 ||
    bits !== 16 ||
    channels !== 1 ||
    rate < 8000 ||
    rate > 192000
  )
    throw new Error('Expected PCM16 mono WAV at a supported sample rate');
  // App accepts takes up to 30 seconds. Score exactly the same prefix in annotations.
  const pcm = Float32Array.from(
    { length: Math.min(data.length / 2, rate * 30) },
    (_, i) => data!.readInt16LE(i * 2) / 32768,
  );
  return { pcm, rate };
}
