export type Instrument =
  | 'piano'
  | 'drums'
  | 'bass'
  | 'guitar'
  | 'strings'
  | 'synth';
export type InputSource = 'hum' | 'microphone-taps' | 'touch';
export interface IntentEvent {
  time: number;
  duration: number;
  pitch: number | null;
  confidence: number;
  intensity: number;
}
export interface MusicalIntent {
  analyzer?: 'crepe-tiny' | 'yin';
  version: 1;
  source: InputSource;
  events: IntentEvent[];
  duration: number;
  confidence: number;
}
export interface SongContext {
  tempo: number;
  key: number;
  mode: 'major' | 'minor';
  confidence: number;
  chords?: number[][];
}
export interface PerformanceEvent {
  time: number;
  duration: number;
  note: number;
  velocity: number;
}
export interface Track {
  id: string;
  instrument: Instrument;
  name: string;
  intent: MusicalIntent;
  events: PerformanceEvent[];
  duration: number;
  original: Blob | null;
  muted: boolean;
  smoother: boolean;
  volume?: number;
  pan?: number;
  solo?: boolean;
  generated?: boolean;
  sourceTempo?: number;
}
export type Feel = 'easy' | 'bright' | 'dreamy' | 'driving';
export interface SectionPart {
  offsetBeats: number;
  repeat: boolean;
  transpose: number;
}
export interface SongSection {
  id: string;
  name: string;
  bars: number;
  energy: number;
  trackIds: string[];
  parts?: Record<string, SectionPart>;
}
export interface ComposeSettings {
  feel: Feel;
  energy: number;
  variation: number;
}
export interface Song {
  version: 1;
  id: string;
  name: string;
  tracks: Track[];
  context: SongContext | null;
  repeat: boolean;
  updatedAt: number;
  sections?: SongSection[];
  compose?: ComposeSettings;
  masterVolume?: number;
}
export const MAX_SECONDS = 30;
export const MAX_TRACKS = 24;
export function newSong(): Song {
  return {
    version: 1,
    id: crypto.randomUUID(),
    name: 'My little song',
    tracks: [],
    context: null,
    repeat: false,
    updatedAt: Date.now(),
  };
}
