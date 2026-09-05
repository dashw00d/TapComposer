export type Instrument = 'piano' | 'drums';
export type InputSource = 'hum' | 'microphone-taps' | 'touch';
export interface IntentEvent {
  time: number;
  duration: number;
  pitch: number | null;
  confidence: number;
  intensity: number;
}
export interface MusicalIntent {
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
}
export interface Song {
  version: 1;
  id: string;
  name: string;
  tracks: Track[];
  context: SongContext | null;
  repeat: boolean;
  updatedAt: number;
}
export const MAX_SECONDS = 30;
export const MAX_TRACKS = 12;
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
