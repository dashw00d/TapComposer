/* Captures mono PCM without ever routing microphone audio to the speakers. */
class TapCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.startAt = options.processorOptions.startAt;
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
  process(inputs) {
    if (this.done) return false;
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    const skip = Math.max(
      0,
      Math.ceil((this.startAt - currentTime) * sampleRate),
    );
    if (skip >= channel.length) return true;
    const count = Math.min(channel.length - skip, this.limit - this.length);
    this.samples.set(channel.subarray(skip, skip + count), this.length);
    this.length += count;
    if (++this.meterFrames % 12 === 0) {
      let energy = 0;
      for (const v of channel) energy += v * v;
      this.port.postMessage({
        type: 'meter',
        level: Math.sqrt(energy / channel.length),
        elapsed: this.length / sampleRate,
      });
    }
    if (this.length >= this.limit) this.finish();
    return !this.done;
  }
}
registerProcessor('tap-capture', TapCapture);
