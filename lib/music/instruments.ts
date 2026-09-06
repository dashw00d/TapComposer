import type { Instrument } from './types';
export const INSTRUMENTS: {
  id: Instrument;
  name: string;
  color: string;
  description: string;
}[] = [
  {
    id: 'piano',
    name: 'Piano',
    color: '#c7bdf5',
    description: 'A melody or a little rhythm.',
  },
  {
    id: 'drums',
    name: 'Drums',
    color: '#f2c276',
    description: 'Your groove, filled out.',
  },
  {
    id: 'bass',
    name: 'Bass',
    color: '#a9d9c0',
    description: 'Give your idea a heartbeat.',
  },
  {
    id: 'guitar',
    name: 'Guitar',
    color: '#f0a18d',
    description: 'A riff or an easy strum.',
  },
  {
    id: 'strings',
    name: 'Strings',
    color: '#96c8ea',
    description: 'Make a little room to dream.',
  },
  {
    id: 'synth',
    name: 'Synth',
    color: '#e6a5d9',
    description: 'Something a little unexpected.',
  },
];
export const instrumentInfo = (instrument: Instrument) =>
  INSTRUMENTS.find((i) => i.id === instrument)!;
