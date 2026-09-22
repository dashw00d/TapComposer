'use client';
import { useRef, useState } from 'react';
import type { PerformanceEvent, SongContext, Track } from '@/lib/music/types';
import {
  editNote,
  editNoteGeometry,
  guidedPitch,
  inSongKey,
  magneticTime,
  noteName,
  stepTime,
  fitLoopToNotes,
} from '@/lib/music/cleanup';

export function NoteCleanup({
  track,
  onChange,
  onPlay,
  onAudition,
  playing,
  onUndo,
  canUndo,
  tempo,
  context,
}: {
  track: Track;
  tempo?: number;
  context?: SongContext | null;
  onChange: (next: Track) => void;
  onPlay: () => void;
  onAudition: (track: Track, index: number) => void;
  playing: boolean;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<{
    index: number;
    event: PerformanceEvent;
  } | null>(null);
  const [page, setPage] = useState(0);
  const [range] = useState(() => {
    const low = track.events.length
      ? Math.min(...track.events.map((e) => e.note))
      : 60;
    const high = track.events.length
      ? Math.max(...track.events.map((e) => e.note))
      : 71;
    return {
      low: Math.max(0, Math.min(low - 4, high - 11)),
      high: Math.min(127, high + 4),
    };
  });
  const gesture = useRef<{
    index: number;
    x: number;
    y: number;
    event: PerformanceEvent;
    next: PerformanceEvent;
    resize: boolean;
    moved: boolean;
  } | null>(null);
  const drums = track.instrument === 'drums',
    beat = 60 / (track.sourceTempo ?? tempo ?? 100),
    px = 72,
    row = drums ? 40 : 18,
    keys = 54;
  const loopBars = Math.max(1, Math.ceil(track.duration / (4 * beat) - 1e-8));
  const bars = Math.min(4, loopBars),
    span = bars * 4 * beat;
  const pageStart =
    Math.min(page, Math.max(0, Math.ceil(track.duration / span) - 1)) * span;
  const low = Math.min(range.low, ...track.events.map((e) => e.note)),
    high = Math.max(range.high, ...track.events.map((e) => e.note));
  const pitches = drums
    ? [...new Set([42, 38, 36, ...track.events.map((e) => e.note)])].sort(
        (a, b) => b - a,
      )
    : Array.from({ length: high - low + 1 }, (_, i) => high - i);
  const height = pitches.length * row;
  const notes = track.events
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        event.time + event.duration > pageStart &&
        event.time < pageStart + span,
    );
  const pitchLabel = (pitch: number) =>
    drums
      ? pitch === 36
        ? 'Kick'
        : pitch === 38
          ? 'Snare'
          : 'Hi-hat'
      : noteName(pitch);
  function update(index: number, event: PerformanceEvent) {
    const next = editNoteGeometry(track, index, event);
    onChange(next);
    if (event.time < pageStart || event.time >= pageStart + span)
      setPage(Math.floor(event.time / span));
    onAudition(next, index);
  }
  function add(time: number, pitch: number) {
    if (track.events.length >= 10000) return;
    time = magneticTime(time, beat);
    if (time >= 119.98) return;
    const note = drums ? pitch : guidedPitch(pitch, context);
    const existing = track.events.findIndex(
      (e) => e.note === note && Math.abs(e.time - time) < 0.001,
    );
    if (existing >= 0) {
      setSelected(existing);
      onAudition(track, existing);
      return;
    }
    const event = {
      time,
      note,
      duration: Math.min(drums ? beat / 4 : beat, 120 - time),
      velocity: 0.7,
    };
    const next = {
      ...track,
      events: [...track.events, event],
      duration: Math.max(track.duration, time + event.duration),
      pinned: true,
      edited: true,
    };
    onChange(next);
    setPage(Math.floor(time / span));
    setSelected(track.events.length);
    onAudition(next, track.events.length);
  }
  return (
    <section className="piano-editor" aria-label="Edit notes">
      <div className="piano-toolbar">
        <strong>{drums ? 'Drum pattern' : 'Note editor'}</strong>
        <button className="button primary" onClick={onPlay}>
          {playing ? 'Stop' : 'Play part'}
        </button>
        <button
          className="button"
          onClick={() => {
            const e = selected !== null ? track.events[selected] : undefined;
            add(
              e ? e.time + e.duration : pageStart,
              e?.note ?? (drums ? 36 : guidedPitch(60, context)),
            );
          }}
          disabled={track.events.length >= 10000}
        >
          Add {drums ? 'hit' : 'note'}
        </button>
        <button className="button" onClick={onUndo} disabled={!canUndo}>
          Undo
        </button>
        <button
          className="button"
          disabled={selected === null || !track.events[selected]}
          onClick={() => {
            if (selected !== null)
              onChange(editNote(track, selected, 'remove'));
            setSelected(null);
          }}
        >
          Delete {drums ? 'hit' : 'note'}
        </button>
      </div>
      <p>
        {drums
          ? 'Drag hits sideways for timing, or up and down to change the drum.'
          : 'Drag up or down to change the note. Drag sideways for timing. Pull the right edge to make it longer.'}
      </p>
      <div className="note-guidance">
        <span>
          Loop: {loopBars} {loopBars === 1 ? 'bar' : 'bars'} ·{' '}
          {((loopBars * 4 * 60) / (tempo ?? 100)).toFixed(1)} seconds
        </span>
        <span>Magnetic timing · ¼ beat</span>
        {!drums && context && (
          <span>
            Notes stay in {noteName(context.key, false)} {context.mode} ·
            highlighted rows
          </span>
        )}
        <span className="note-selection">
          {selected !== null && track.events[selected]
            ? `${pitchLabel(track.events[selected].note)} · beat ${+(track.events[selected].time / beat + 1).toFixed(2)}`
            : 'Click a note to hear it'}
        </span>
      </div>
      <div className="piano-scroll">
        <div
          className="piano-canvas"
          style={{ width: keys + bars * 4 * px, height: height + 25 }}
        >
          <div className="piano-ruler" style={{ left: keys }}>
            {Array.from({ length: bars * 4 }, (_, i) => (
              <span
                key={i}
                className={i % 4 === 0 ? 'bar-mark' : 'beat-mark'}
                style={{ left: i * px }}
              >
                {i % 4 === 0
                  ? `Bar ${Math.round(pageStart / beat / 4) + i / 4 + 1}`
                  : (i % 4) + 1}
              </span>
            ))}
          </div>
          <div className="piano-keys" style={{ top: 25, width: keys }}>
            {pitches.map((pitch) => (
              <div
                key={pitch}
                className={`${!drums && [1, 3, 6, 8, 10].includes(pitch % 12) ? 'black-key' : ''} ${!drums && !inSongKey(pitch, context) ? 'outside-key' : ''}`}
                style={{ height: row }}
              >
                {pitchLabel(pitch)}
              </div>
            ))}
          </div>
          <div
            className="piano-grid"
            style={{
              left: keys,
              top: 25,
              width: bars * 4 * px,
              height,
              backgroundSize: `${px / 4}px ${row}px, ${px}px ${row}px, ${px}px ${row}px`,
            }}
            onDoubleClick={(e) => {
              if (e.target !== e.currentTarget) return;
              const rect = e.currentTarget.getBoundingClientRect();
              add(
                ((e.clientX - rect.left) / px) * beat + pageStart,
                pitches[
                  Math.max(
                    0,
                    Math.min(
                      pitches.length - 1,
                      Math.floor((e.clientY - rect.top) / row),
                    ),
                  )
                ],
              );
            }}
          >
            {!drums &&
              context &&
              pitches.map((pitch, i) => (
                <div
                  className={`pitch-row ${inSongKey(pitch, context) ? 'in-key' : ''}`}
                  aria-hidden="true"
                  key={pitch}
                  style={{ top: i * row, height: row }}
                />
              ))}
            {notes.map(({ event: original, index }) => {
              const event = draft?.index === index ? draft.event : original;
              const start = Math.max(event.time, pageStart),
                end = Math.min(event.time + event.duration, pageStart + span);
              return (
                <button
                  key={index}
                  className="piano-note"
                  aria-label={`Note ${index + 1}, ${pitchLabel(original.note)}, beat ${+(original.time / beat + 1).toFixed(2)}`}
                  title={`${pitchLabel(event.note)} · beat ${+(event.time / beat + 1).toFixed(2)}`}
                  aria-pressed={selected === index}
                  style={{
                    left: ((start - pageStart) / beat) * px,
                    top: pitches.indexOf(event.note) * row + 1,
                    width: Math.max(12, ((end - start) / beat) * px),
                    height: row - 2,
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.currentTarget.focus();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setSelected(index);
                    const rect = e.currentTarget.getBoundingClientRect();
                    gesture.current = {
                      index,
                      x: e.clientX,
                      y: e.clientY,
                      event: original,
                      next: original,
                      resize: e.clientX >= rect.right - 9,
                      moved: false,
                    };
                  }}
                  onPointerMove={(e) => {
                    const g = gesture.current;
                    if (!g || g.index !== index) return;
                    const dx = e.clientX - g.x,
                      dy = g.y - e.clientY;
                    g.moved ||= Math.abs(dx) > 3 || Math.abs(dy) > 3;
                    const pitch =
                      pitches[
                        Math.max(
                          0,
                          Math.min(
                            pitches.length - 1,
                            pitches.indexOf(g.event.note) -
                              Math.round(dy / row),
                          ),
                        )
                      ];
                    const time =
                      !g.resize && Math.abs(dx) > 3
                        ? Math.max(
                            0,
                            Math.min(
                              119.98,
                              magneticTime(
                                g.event.time + (dx / px) * beat,
                                beat,
                              ),
                            ),
                          )
                        : g.event.time;
                    let note =
                      g.resize || Math.abs(dy) < row / 2
                        ? g.event.note
                        : drums
                          ? pitch
                          : guidedPitch(pitch, context, Math.sign(dy));
                    if (!drums && !pitches.includes(note)) {
                      const allowed = pitches.filter((n) =>
                        inSongKey(n, context),
                      );
                      note = allowed.reduce(
                        (closest, n) =>
                          Math.abs(n - note) < Math.abs(closest - note)
                            ? n
                            : closest,
                        allowed[0] ?? g.event.note,
                      );
                    }
                    const duration = g.resize
                      ? Math.max(
                          stepTime(g.event.time, beat, 1) - g.event.time,
                          magneticTime(
                            g.event.time + g.event.duration + (dx / px) * beat,
                            beat,
                          ) - g.event.time,
                        )
                      : g.event.duration;
                    g.next = {
                      ...g.event,
                      time,
                      note,
                      duration: Math.min(120 - time, duration),
                    };
                    setDraft({ index, event: g.next });
                  }}
                  onPointerUp={(e) => {
                    const g = gesture.current;
                    if (!g) return;
                    gesture.current = null;
                    setDraft(null);
                    e.currentTarget.releasePointerCapture(e.pointerId);
                    if (g.moved) update(index, g.next);
                    else onAudition(track, index);
                  }}
                  onPointerCancel={() => {
                    gesture.current = null;
                    setDraft(null);
                  }}
                  onClick={(e) => {
                    if (e.detail === 0) {
                      setSelected(index);
                      onAudition(track, index);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Delete' || e.key === 'Backspace') {
                      e.preventDefault();
                      onChange(editNote(track, index, 'remove'));
                      setSelected(null);
                      return;
                    }
                    if (
                      ![
                        'ArrowLeft',
                        'ArrowRight',
                        'ArrowUp',
                        'ArrowDown',
                      ].includes(e.key)
                    )
                      return;
                    e.preventDefault();
                    const vertical =
                        e.key === 'ArrowUp'
                          ? 1
                          : e.key === 'ArrowDown'
                            ? -1
                            : 0,
                      horizontal =
                        e.key === 'ArrowRight'
                          ? 1
                          : e.key === 'ArrowLeft'
                            ? -1
                            : 0;
                    const note = vertical
                      ? drums
                        ? pitches[
                            Math.max(
                              0,
                              Math.min(
                                pitches.length - 1,
                                pitches.indexOf(original.note) - vertical,
                              ),
                            )
                          ]
                        : guidedPitch(
                            original.note + vertical,
                            context,
                            vertical,
                          )
                      : original.note;
                    update(index, {
                      ...original,
                      note,
                      time:
                        horizontal && !e.shiftKey
                          ? stepTime(original.time, beat, horizontal)
                          : original.time,
                      duration:
                        horizontal && e.shiftKey
                          ? Math.max(
                              beat / 4,
                              stepTime(
                                original.time + original.duration,
                                beat,
                                horizontal,
                              ) - original.time,
                            )
                          : original.duration,
                    });
                  }}
                >
                  <span className="note-name">{pitchLabel(event.note)}</span>
                  <span className="note-grip" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="piano-footer">
        <span>
          Double-click empty space to add {drums ? 'a hit' : 'a note'}
        </span>
        <button
          className="text-button"
          disabled={pageStart === 0}
          onClick={() => setPage(Math.max(0, page - 1))}
        >
          ← Earlier bars
        </button>
        <button
          className="text-button"
          disabled={pageStart + span >= track.duration}
          onClick={() => setPage(page + 1)}
        >
          Later bars →
        </button>
        <button
          className="text-button"
          disabled={!track.events.length}
          title="Shifts the whole pattern to its first note; your recording stays unchanged"
          onClick={() => {
            onChange(fitLoopToNotes(track, tempo));
            setPage(0);
          }}
        >
          Fit loop to notes
        </button>
      </div>
    </section>
  );
}
