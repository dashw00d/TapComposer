import type { Track } from '../music/types';

export interface ReferenceNote {
  time: number;
  duration: number;
  pitch: number;
}
export const VOCAL_STYLES = [
  {
    id: 'hmm',
    label: 'Hmm · closed-mouth hum',
    short: 'Hmm',
    instruction:
      'Keep your lips gently closed. Make one “hm” for each note; briefly stop the sound between repeated notes. Hold the “mmm” through long notes. Use a comfortable voice, without forcing it.',
  },
  {
    id: 'daa',
    label: 'Daa · one soft D per note',
    short: 'Daa',
    instruction:
      'Open your mouth and sing “daa.” Start every note with a soft D, then hold the “aa” vowel. Use “da da” for short notes and “daaa” for long ones. Sing it at the guide’s pitch rather than speaking it.',
  },
  {
    id: 'baa',
    label: 'Baa · one soft B per note',
    short: 'Baa',
    instruction:
      'Sing “baa,” gently closing and opening your lips for each B. Hold the “aa” vowel at the guide’s pitch. Give repeated notes separate “ba” starts; avoid deliberately blowing into the microphone.',
  },
] as const;
export type VocalStyle = (typeof VOCAL_STYLES)[number]['id'];
export const DISTANCES = [
  { cm: 15, label: 'Close · 15 cm / 6 in' },
  { cm: 40, label: 'Desk · 40 cm / 16 in' },
  { cm: 80, label: 'Farther · 80 cm / 31 in' },
] as const;
export interface Melody {
  id: string;
  name: string;
  purpose: string;
  // Semitones above the chosen root, note lengths in beats, and optional rest after.
  notes: readonly (readonly [number, number, number?])[];
}
export const MELODIES: Melody[] = [
  {
    id: 'held',
    name: 'One steady note',
    purpose: 'Keep a held note steady without breaking it into extra notes.',
    notes: [
      [0, 4],
      [0, 2, 1],
    ],
  },
  {
    id: 'same',
    name: 'Same note, new syllable',
    purpose: 'Separate repeated notes even though the pitch stays the same.',
    notes: [
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 2],
    ],
  },
  {
    id: 'up',
    name: 'Four steps up',
    purpose: 'Make small, clear upward pitch changes.',
    notes: [
      [0, 1],
      [2, 1],
      [4, 1],
      [5, 2],
    ],
  },
  {
    id: 'down',
    name: 'Four steps down',
    purpose: 'Keep the ends of descending notes clear.',
    notes: [
      [5, 1],
      [4, 1],
      [2, 1],
      [0, 2],
    ],
  },
  {
    id: 'hill',
    name: 'Over the hill',
    purpose: 'Rise and fall at a steady pace.',
    notes: [
      [0, 1],
      [2, 1],
      [4, 1],
      [5, 1],
      [4, 1],
      [2, 1],
      [0, 2],
    ],
  },
  {
    id: 'two',
    name: 'Two-note conversation',
    purpose: 'Switch cleanly between two neighboring pitches.',
    notes: [
      [0, 1],
      [2, 1],
      [0, 1],
      [2, 1],
      [0, 2],
    ],
  },
  {
    id: 'thirds',
    name: 'Little skips',
    purpose: 'Jump a little farther without filling the gap with extra notes.',
    notes: [
      [0, 1],
      [4, 1],
      [2, 1],
      [5, 1],
      [4, 1],
      [0, 2],
    ],
  },
  {
    id: 'chord',
    name: 'Up a chord, back home',
    purpose: 'Try wider pitch jumps with the same clear syllables.',
    notes: [
      [0, 1],
      [4, 1],
      [7, 2],
      [4, 1],
      [0, 2],
    ],
  },
  {
    id: 'repeat-rise',
    name: 'Repeat, then rise',
    purpose: 'Mix repeated syllables with real pitch changes.',
    notes: [
      [0, 0.5],
      [0, 0.5],
      [2, 1],
      [2, 0.5],
      [2, 0.5],
      [4, 1],
      [0, 2],
    ],
  },
  {
    id: 'short-long',
    name: 'Short, short, long',
    purpose: 'Keep short notes separate and long notes in one piece.',
    notes: [
      [0, 0.5],
      [2, 0.5],
      [4, 2],
      [2, 0.5],
      [0, 0.5],
      [0, 2],
    ],
  },
  {
    id: 'space',
    name: 'Leave some space',
    purpose: 'Let silence stay silent. Watch the rest markers.',
    notes: [
      [0, 1, 1],
      [4, 1, 1],
      [2, 1, 1],
      [0, 1],
    ],
  },
  {
    id: 'hold-step',
    name: 'Hold, then step',
    purpose: 'Finish a long note before moving one step up.',
    notes: [
      [0, 3],
      [2, 1],
      [4, 1],
      [2, 1],
      [0, 2],
    ],
  },
  {
    id: 'bounce',
    name: 'A little bounce',
    purpose: 'Follow half-beat notes without speeding up.',
    notes: [
      [0, 0.5],
      [2, 0.5],
      [4, 1],
      [2, 0.5],
      [4, 0.5],
      [5, 1],
      [4, 1],
      [0, 2],
    ],
  },
  {
    id: 'wide',
    name: 'A bigger leap',
    purpose: 'Hold a wider jump without slipping into a different octave.',
    notes: [
      [0, 1],
      [7, 2],
      [5, 1],
      [2, 1],
      [0, 2],
    ],
  },
  {
    id: 'phrase',
    name: 'Put it all together',
    purpose: 'A short tune with repeats, movement, a rest, and a held ending.',
    notes: [
      [0, 0.5],
      [0, 0.5],
      [4, 1],
      [7, 1],
      [5, 1, 0.5],
      [4, 0.5],
      [2, 1],
      [0, 2],
    ],
  },
];
export function noteName(pitch: number) {
  const names = [
    'C',
    'C♯',
    'D',
    'D♯',
    'E',
    'F',
    'F♯',
    'G',
    'G♯',
    'A',
    'A♯',
    'B',
  ];
  return (
    names[((Math.round(pitch) % 12) + 12) % 12] +
    (Math.floor(Math.round(pitch) / 12) - 1)
  );
}
export function melodyScore(melody: Melody, root: number, bpm: number) {
  const beat = 60 / bpm;
  let at = 1; // Keep one second of room sound before the first note.
  const notes = melody.notes.map(([offset, beats, rest = 0]) => {
    const note = {
      time: at,
      pitch: root + offset,
      duration: Math.max(0.08, beats * beat - 0.08),
    };
    at += (beats + rest) * beat;
    return note;
  });
  return { notes, duration: at + 1, beat };
}
export function referenceTrack(
  notes: ReferenceNote[],
  duration: number,
): Track {
  return {
    id: 'tuning-guide',
    name: 'Reference melody',
    instrument: 'synth',
    intent: {
      version: 1,
      source: 'hum',
      confidence: 1,
      duration,
      events: notes.map((n) => ({ ...n, intensity: 0.6, confidence: 1 })),
    },
    events: notes.map((n) => ({
      time: n.time,
      duration: n.duration,
      note: n.pitch,
      velocity: 0.55,
    })),
    duration,
    original: null,
    muted: false,
    smoother: false,
  };
}
export interface LabTake {
  id: string;
  setup: { singer: string; microphone: string; room: string };
  trialKey: string;
  createdAt: number;
  melodyId: string;
  style: VocalStyle;
  distanceCm: number;
  root: number;
  bpm: number;
  split: 'dev' | 'heldout';
  guideDuringRecording: boolean;
  listening: 'headphones' | 'speakers';
  referenceKind: 'prompt-score';
  reference: ReferenceNote[];
  duration: number;
  sampleRate: number;
  audio: Blob;
  peak: number;
  rms: number;
  clippedFraction: number;
  note: string;
}
export interface LabSession {
  version: 1;
  id: string;
  createdAt: number;
  singer: string;
  microphone: string;
  room: string;
  takes: LabTake[];
}
export type ExportedLabSession = Omit<LabSession, 'takes'> & {
  format: 'tapcomposer-voice-lab';
  takes: (Omit<LabTake, 'audio'> & { audioBase64: string })[];
};
export function trialKey(
  melodyId: string,
  style: VocalStyle,
  distanceCm: number,
  root: number,
  bpm: number,
  split: string,
  guide: boolean,
  listening: string,
  setup?: Pick<LabSession, 'singer' | 'microphone' | 'room'> | null,
) {
  return [
    melodyId,
    style,
    distanceCm,
    root,
    bpm,
    split,
    guide ? 'guide' : 'quiet',
    listening,
    JSON.stringify([
      setup?.singer ?? '',
      setup?.microphone ?? '',
      setup?.room ?? '',
    ]),
  ].join(':');
}
export function audioQuality(pcm: Float32Array) {
  let peak = 0,
    energy = 0,
    clipped = 0;
  for (const sample of pcm) {
    peak = Math.max(peak, Math.abs(sample));
    energy += sample * sample;
    if (Math.abs(sample) >= 0.999) clipped++;
  }
  return {
    peak,
    rms: Math.sqrt(energy / Math.max(1, pcm.length)),
    clippedFraction: clipped / Math.max(1, pcm.length),
  };
}
