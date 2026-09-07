/* Captures mono PCM without ever routing microphone audio to the speakers. */
class TapCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.startAt = options.processorOptions.startAt;
    this.startFrame = Math.round(this.startAt * sampleRate);
    this.limit = Math.round(sampleRate * 30);
    this.samples = new Float32Array(this.limit);
    this.length = 0;
    this.done = false;
    this.meterFrames = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.finish();
    };
  }
  finish() {
    if (this.done) return;
    this.done = true;
    const pcm = this.samples.slice(0, this.length);
    this.port.postMessage({ type: 'complete', pcm }, [pcm.buffer]);
  }
  process(inputs, outputs) {
    if (this.done) return false;
    const channel = inputs[0]?.[0];
    const frames = outputs?.[0]?.[0]?.length ?? channel?.length ?? 128;
    const relativeFrame =
      Math.round(currentTime * sampleRate) - this.startFrame;
    const skip = Math.max(0, -relativeFrame);
    if (skip >= frames) return true;
    const offset = Math.max(0, relativeFrame);
    if (offset >= this.limit) {
      this.length = this.limit;
      this.finish();
      return false;
    }
    const count = Math.min(frames - skip, this.limit - offset);
    // Missing input remains silence on the timeline; it must never pull later
    // audio forward or delay the 30-second limit.
    if (channel) this.samples.set(channel.subarray(skip, skip + count), offset);
    this.length = Math.max(this.length, offset + count);
    if (++this.meterFrames % 12 === 0) {
      let energy = 0;
      if (channel)
        for (const v of channel.subarray(skip, skip + count)) energy += v * v;
      this.port.postMessage({
        type: 'meter',
        level: Math.sqrt(energy / count),
        elapsed: this.length / sampleRate,
      });
    }
    if (this.length >= this.limit) this.finish();
    return !this.done;
  }
}
registerProcessor('tap-capture', TapCapture);
