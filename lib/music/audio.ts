import type { Track } from './types';
import { songDuration } from './resolve';
import { encodeWav } from './wav';

const SAMPLE_NOTES = Array.from({ length: 17 }, (_, i) => 36 + i * 3);
function sampleName(note: number) {
  return (
    ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'][
      note % 12
    ] +
    (Math.floor(note / 12) - 1)
  );
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private buffers = new Map<number, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private playing: AudioBufferSourceNode[] = [];
  private master: GainNode | null = null;
  private repeatTimer: ReturnType<typeof setTimeout> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private workletLoaded = false;

  async ready(): Promise<AudioContext> {
    if (!this.context || this.context.state === 'closed')
      this.context = new AudioContext({ latencyHint: 'interactive' });
    await this.context.resume();
    return this.context;
  }
  async load(): Promise<void> {
    const context = await this.ready();
    if (this.buffers.size === SAMPLE_NOTES.length) return;
    if (!this.loading) {
      this.loading = Promise.all(
        SAMPLE_NOTES.map(async (note) => {
          const response = await fetch(`/samples/${sampleName(note)}.mp3`);
          if (!response.ok)
            throw new Error(
              'The piano sounds could not load. Check your connection and try again.',
            );
          this.buffers.set(
            note,
            await context.decodeAudioData(await response.arrayBuffer()),
          );
        }),
      )
        .then(() => undefined)
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }
  async prepareCapture() {
    const context = await this.ready();
    if (!this.workletLoaded) {
      await context.audioWorklet.addModule('/worklets/capture.js');
      this.workletLoaded = true;
    }
    return context;
  }
  private mix(context: BaseAudioContext, tracks: number) {
    const master = context.createGain();
    master.gain.value = 0.68 / Math.sqrt(Math.max(1, tracks));
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    master.connect(compressor).connect(context.destination);
    // A short, quiet stereo room gives the dry samples some space.
    const convolver = context.createConvolver();
    const impulse = context.createBuffer(
      2,
      Math.floor(context.sampleRate * 0.42),
      context.sampleRate,
    );
    let seed = 12345;
    for (let c = 0; c < 2; c++) {
      const data = impulse.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 16807) % 2147483647;
        data[i] = ((seed / 2147483647) * 2 - 1) * (1 - i / data.length) ** 3;
      }
    }
    convolver.buffer = impulse;
    const wet = context.createGain();
    wet.gain.value = 0.09;
    master.connect(convolver).connect(wet).connect(compressor);
    return master;
  }
  private drum(context: BaseAudioContext, note: number): AudioBuffer {
    const length = Math.floor(
      context.sampleRate * (note === 36 ? 0.5 : note === 38 ? 0.24 : 0.085),
    );
    const buffer = context.createBuffer(1, length, context.sampleRate),
      data = buffer.getChannelData(0);
    let seed = 1009,
      phase = 0,
      previous = 0;
    for (let i = 0; i < length; i++) {
      const time = i / context.sampleRate;
      seed = (seed * 16807) % 2147483647;
      const noise = (seed / 2147483647) * 2 - 1;
      if (note === 36) {
        phase +=
          (2 * Math.PI * (48 + 100 * Math.exp(-time * 38))) /
          context.sampleRate;
        data[i] =
          Math.sin(phase) * Math.exp(-time * 10) * 0.9 +
          noise * Math.exp(-time * 200) * 0.1;
      } else if (note === 38)
        data[i] =
          (noise * 0.63 + Math.sin(2 * Math.PI * 180 * time) * 0.32) *
          Math.exp(-time * 20) *
          Math.min(1, time * 2000);
      else
        data[i] =
          (noise - previous) *
          0.23 *
          Math.exp(-time * 55) *
          Math.min(1, time * 3000);
      previous = noise;
    }
    return buffer;
  }
  private schedule(
    context: BaseAudioContext,
    master: GainNode,
    tracks: Track[],
    startAt: number,
    collect: boolean,
  ) {
    const drumBuffers = new Map<number, AudioBuffer>();
    for (const track of tracks.filter((t) => !t.muted))
      for (const event of track.events) {
        const source = context.createBufferSource(),
          gain = context.createGain();
        const at = startAt + event.time;
        let release = 0.09;
        if (track.instrument === 'piano') {
          const sample = SAMPLE_NOTES.reduce((best, note) =>
            Math.abs(note - event.note) < Math.abs(best - event.note)
              ? note
              : best,
          );
          const buffer = this.buffers.get(sample);
          if (!buffer)
            throw new Error(
              'The piano is still loading. Try again in a moment.',
            );
          source.buffer = buffer;
          source.playbackRate.value = 2 ** ((event.note - sample) / 12);
          release = 0.24;
        } else {
          if (!drumBuffers.has(event.note))
            drumBuffers.set(event.note, this.drum(context, event.note));
          source.buffer = drumBuffers.get(event.note)!;
        }
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(event.velocity, at + 0.003);
        gain.gain.setValueAtTime(
          event.velocity,
          at + Math.max(0.01, event.duration),
        );
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          at + event.duration + release,
        );
        source.connect(gain).connect(master);
        source.start(at);
        source.stop(at + event.duration + release + 0.01);
        if (collect) {
          this.playing.push(source);
          source.onended = () => {
            this.playing = this.playing.filter((s) => s !== source);
            source.disconnect();
            gain.disconnect();
          };
        }
      }
  }
  async play(
    tracks: Track[],
    repeat: boolean,
    onEnd: () => void,
    scheduledAt?: number,
  ): Promise<{ startAt: number; duration: number } | null> {
    this.stop();
    const generation = this.generation;
    const context = await this.ready();
    if (tracks.some((t) => t.instrument === 'piano' && !t.muted))
      await this.load();
    if (generation !== this.generation) return null;
    const duration = songDuration(tracks);
    if (!duration || !tracks.some((t) => !t.muted)) return null;
    const startAt = Math.max(
      context.currentTime + 0.04,
      scheduledAt ?? context.currentTime + 0.07,
    );
    const master = this.mix(context, tracks.filter((t) => !t.muted).length);
    this.master = master;
    let nextAt = startAt;
    const schedule = () => {
      if (generation !== this.generation) return;
      // Schedule one phrase ahead using the audio clock; timers only replenish it.
      while (nextAt < context.currentTime + duration + 0.12) {
        this.schedule(context, master, tracks, nextAt, true);
        nextAt += duration;
        if (!repeat) break;
      }
      if (repeat)
        this.repeatTimer = setTimeout(schedule, Math.min(250, duration * 250));
    };
    schedule();
    if (!repeat)
      this.stopTimer = setTimeout(
        () => {
          if (generation === this.generation) {
            this.stop();
            onEnd();
          }
        },
        (startAt - context.currentTime + duration + 0.3) * 1000,
      );
    return { startAt, duration };
  }
  stop() {
    this.generation++;
    if (this.repeatTimer) clearTimeout(this.repeatTimer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.repeatTimer = null;
    this.stopTimer = null;
    for (const source of this.playing) {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
    }
    this.playing = [];
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(0.00001, this.context.currentTime, 0.01);
      const old = this.master;
      setTimeout(() => old.disconnect(), 80);
    }
    this.master = null;
  }
  get currentTime() {
    return this.context?.currentTime ?? 0;
  }
  async tap(velocity = 0.8) {
    const context = await this.ready(),
      source = context.createBufferSource(),
      gain = context.createGain();
    source.buffer = this.drum(context, 36);
    gain.gain.value = velocity * 0.4;
    source.connect(gain).connect(context.destination);
    source.start();
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
  }
  async render(tracks: Track[]): Promise<AudioBuffer> {
    if (tracks.some((t) => t.instrument === 'piano' && !t.muted))
      await this.load();
    const duration = songDuration(tracks);
    if (!duration || !tracks.some((t) => !t.muted))
      throw new Error('Add a part and turn its sound on before saving audio.');
    const context = new OfflineAudioContext(
      2,
      Math.ceil((duration + 0.7) * 44100),
      44100,
    );
    this.schedule(
      context,
      this.mix(context, tracks.filter((t) => !t.muted).length),
      tracks,
      0.02,
      false,
    );
    const buffer = await context.startRendering();
    // Peak limit the exported mix without changing track balances.
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++)
      for (const value of buffer.getChannelData(c))
        peak = Math.max(peak, Math.abs(value));
    if (peak > 0.97)
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) data[i] *= 0.97 / peak;
      }
    return buffer;
  }
  async exportWav(tracks: Track[]) {
    const buffer = await this.render(tracks);
    return encodeWav(
      [buffer.getChannelData(0), buffer.getChannelData(1)],
      buffer.sampleRate,
    );
  }
  async close() {
    this.stop();
    if (this.context) await this.context.close();
    this.context = null;
    this.workletLoaded = false;
  }
}
