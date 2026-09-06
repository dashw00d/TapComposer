'use client';
import { useReducer } from 'react';
import type { Song } from '@/lib/music/types';
interface State {
  present: Song | null;
  past: Song[];
  future: Song[];
}
type Action =
  | { type: 'load'; song: Song }
  | { type: 'edit'; song: Song }
  | { type: 'undo' | 'redo' };
export function songHistoryReducer(state: State, action: Action): State {
  if (action.type === 'load')
    return { present: action.song, past: [], future: [] };
  if (action.type === 'edit')
    return {
      present: action.song,
      past: state.present
        ? [...state.past, state.present].slice(-50)
        : state.past,
      future: [],
    };
  if (action.type === 'undo' && state.past.length)
    return {
      present: state.past.at(-1)!,
      past: state.past.slice(0, -1),
      future: state.present ? [state.present, ...state.future] : state.future,
    };
  if (action.type === 'redo' && state.future.length)
    return {
      present: state.future[0],
      past: state.present ? [...state.past, state.present] : state.past,
      future: state.future.slice(1),
    };
  return state;
}
export function useSongHistory() {
  const [state, dispatch] = useReducer(songHistoryReducer, {
    present: null,
    past: [],
    future: [],
  });
  return {
    song: state.present,
    load: (song: Song) => dispatch({ type: 'load', song }),
    edit: (song: Song) =>
      dispatch({ type: 'edit', song: { ...song, updatedAt: Date.now() } }),
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    canUndo: !!state.past.length,
    canRedo: !!state.future.length,
  };
}
