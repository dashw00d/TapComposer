import { Mp3Encoder } from '@breezystack/lamejs';
self.onmessage = (
  event: MessageEvent<{
    left: Float32Array;
    right: Float32Array;
    rate: number;
  }>,
) => {
  try {
    const { left, right, rate } = event.data;
    const encode = (channel: Float32Array) => {
      const data = new Int16Array(channel.length);
      for (let i = 0; i < data.length; i++)
        data[i] = Math.round(Math.max(-1, Math.min(1, channel[i])) * 32767);
      return data;
    };
    const l = encode(left),
      r = encode(right),
      encoder = new Mp3Encoder(2, rate, 192),
      chunks: Uint8Array<ArrayBuffer>[] = [];
    for (let i = 0; i < l.length; i += 1152) {
      const data = encoder.encodeBuffer(
        l.subarray(i, i + 1152),
        r.subarray(i, i + 1152),
      );
      if (data.length) chunks.push(new Uint8Array(data));
    }
    chunks.push(new Uint8Array(encoder.flush()));
    self.postMessage({ blob: new Blob(chunks, { type: 'audio/mpeg' }) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'MP3 export failed.',
    });
  }
};
