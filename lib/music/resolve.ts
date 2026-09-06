import { chordAt } from './harmony';
import type {
  MusicalIntent,
  SongContext,
  PerformanceEvent,
  Instrument,
  Track,
} from './types';
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export function inferContext(intent: MusicalIntent): SongContext {
  const intervals = intent.events
    .slice(1)
    .map((e, i) => e.time - intent.events[i].time)
    .filter((t) => t > 0.15 && t < 2);
  // Search a modest tempo range. Use durations as fallback for a single held note.
  let tempo = 100,
    best = Infinity;
  for (let bpm = 65; bpm <= 150; bpm++) {
    const beat = 60 / bpm;
    const score =
      intervals.reduce(
        (sum, t) => sum + Math.abs(t / beat - Math.round((t / beat) * 2) / 2),
        0,
      ) /
        Math.max(1, intervals.length) +
      Math.abs(bpm - 100) * 0.0004;
    if (score < best) {
      best = score;
      tempo = bpm;
    }
  }
  const pitches = intent.events.filter((e) => e.pitch !== null);
  let key = 0,
    mode: 'major' | 'minor' = 'major',
    max = -Infinity;
  for (const scaleMode of ['major', 'minor'] as const) {
    const scale =
      scaleMode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
    for (let root = 0; root < 12; root++) {
      let score = 0;
      for (const event of pitches) {
        const pitchClass = (((Math.round(event.pitch!) - root) % 12) + 12) % 12;
        score +=
          (scale.includes(pitchClass) ? 1 : -2) *
          event.duration *
          event.confidence;
        if (pitchClass === 0) score += 0.2;
      }
      if (score > max) {
        max = score;
        key = root;
        mode = scaleMode;
      }
    }
  }
  return {
    tempo,
    key,
    mode,
    confidence: Math.min(0.85, intent.events.length / 12),
  };
}
export function resolveIntent(
  intent: MusicalIntent,
  instrument: Instrument,
  context: SongContext,
  smoother = false,
  preserveOffset = false,
): { events: PerformanceEvent[]; duration: number } {
  if (!intent.events.length) return { events: [], duration: 0 };
  const offset = preserveOffset ? 0 : intent.events[0].time;
  const beat = 60 / context.tempo,
    grid = beat / 2;
  const strength = smoother ? 0.8 : 0.28;
  const events: PerformanceEvent[] = intent.events.flatMap((e, i) => {
    const raw = Math.max(0, e.time - offset);
    const time = Math.max(
      0,
      raw + (Math.round(raw / grid) * grid - raw) * strength,
    );
    let note = Math.round(e.pitch ?? 60);
    if (instrument === 'drums') {
      const position = Math.round(time / beat) % 4;
      note =
        position === 1 || position === 3
          ? 38
          : i === 0 || e.intensity > 0.72 || position === 0
            ? 36
            : 42;
    } else if (smoother && e.confidence < 0.95) {
      const scale =
        context.mode === 'major'
          ? [0, 2, 4, 5, 7, 9, 11]
          : [0, 2, 3, 5, 7, 8, 10];
      const candidates = [note - 1, note, note + 1].filter((n) =>
        scale.includes((((n - context.key) % 12) + 12) % 12),
      );
      if (candidates.length)
        note = candidates.sort(
          (a, b) => Math.abs(a - e.pitch!) - Math.abs(b - e.pitch!),
        )[0];
    }
    if (instrument !== 'drums' && e.pitch === null) {
      const chord = chordAt(time / beat, context);
      const notes =
        instrument === 'bass'
          ? [chord[i % 4 === 3 ? 2 : 0] - 12]
          : instrument === 'synth'
            ? [chord[i % 3] + 12]
            : chord;
      return notes.map((pitch, index) => ({
        time: time + index * (instrument === 'guitar' ? 0.025 : 0.006),
        duration:
          (instrument === 'strings'
            ? 2.8
            : instrument === 'bass'
              ? 0.65
              : 1.3) * beat,
        note: pitch,
        velocity: clamp(e.intensity * 0.7 + 0.15, 0.2, 0.9),
      }));
    }
    if (instrument === 'bass') {
      while (note > 52) note -= 12;
      while (note < 28) note += 12;
    }
    if (instrument === 'guitar') {
      while (note < 40) note += 12;
      while (note > 79) note -= 12;
    }
    return [
      {
        time,
        duration:
          instrument === 'drums'
            ? 0.16
            : clamp(
                e.duration * (instrument === 'strings' ? 1.12 : 1),
                0.08,
                8,
              ),
        note: instrument === 'piano' ? clamp(note, 36, 84) : note,
        velocity: clamp(e.intensity * 0.82 + 0.12, 0.25, 0.95),
      },
    ];
  });
  // A new melodic onset releases the preceding note, avoiding unintended smears.
  if (
    instrument === 'piano' &&
    intent.source === 'hum' &&
    !intent.events.some(
      (event, index) =>
        index > 0 &&
        Math.abs(event.time - intent.events[index - 1].time) < 0.06,
    )
  )
    for (let i = 0; i < events.length - 1; i++)
      events[i].duration = Math.min(
        events[i].duration,
        Math.max(0.06, events[i + 1].time - events[i].time - 0.015),
      );
  const end = Math.max(...events.map((e) => e.time + e.duration));
  return {
    events,
    duration: Math.max(
      beat * 4,
      Math.ceil((end - 0.02) / (beat * 4)) * beat * 4,
    ),
  };
}
export function songDuration(tracks: Track[]): number {
  return tracks.reduce((max, t) => Math.max(max, t.duration), 0);
}
export function smoothTrack(track: Track, context: SongContext): Track {
  const arranged = resolveIntent(
    track.intent,
    track.instrument,
    { ...context, tempo: track.sourceTempo ?? context.tempo },
    !track.smoother,
    true,
  );
  return {
    ...track,
    ...arranged,
    duration: Math.max(track.duration, arranged.duration),
    smoother: !track.smoother,
  };
}
