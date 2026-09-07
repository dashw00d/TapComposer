'use client';
import { useRef, useState } from 'react';
import type { PerformanceEvent, Track } from '@/lib/music/types';
import {
  editNote,
  editNoteGeometry,
  trimQuietEdges,
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
}: {
  track: Track;
  tempo?: number;
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
  const gesture = useRef<{
    index: number;
    x: number;
    y: number;
    event: PerformanceEvent;
    next: PerformanceEvent;
    resize: boolean;
    moved: boolean;
  } | null>(null);
  const beat = 60 / (track.sourceTempo ?? tempo ?? 100),
    px = 72,
    row = track.instrument === 'drums' ? 40 : 18;
  const bars = 4,
    span = bars * 4 * beat;
  const pageStart =
    Math.min(page, Math.max(0, Math.ceil(track.duration / span) - 1)) * span;
  const notes = track.events
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) => event.time >= pageStart && event.time < pageStart + span,
    );
  const lowest = track.events.length
    ? Math.min(...track.events.map((e) => e.note))
    : 60;
  const highest = track.events.length
    ? Math.max(...track.events.map((e) => e.note))
    : 71;
  const high = Math.min(127, highest + 2),
    low = Math.max(0, Math.min(lowest - 2, high - 11));
  const pitches =
    track.instrument === 'drums'
      ? [...new Set([42, 38, 36, ...track.events.map((e) => e.note)])].sort(
          (a, b) => b - a,
        )
      : Array.from({ length: high - low + 1 }, (_, i) => high - i);
  const height = pitches.length * row;
  function update(index: number, event: PerformanceEvent) {
    const next = editNoteGeometry(track, index, event);
    onChange(next);
    onAudition(next, index);
  }
  return (
    <section className="piano-editor" aria-label="Edit notes">
      <div className="piano-toolbar">
        <strong>{track.name}</strong>
        <button className="button primary" onClick={onPlay}>
          {playing ? 'Stop' : 'Play part'}
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
          Delete note
        </button>
      </div>
      <p>
        {track.instrument === 'drums'
          ? 'Drag hits sideways to move them, or up and down to change the drum. Double-click a row to add a hit.'
          : 'Drag a note up or down to change its pitch. Drag sideways to move it. Pull its right edge to change its length.'}
      </p>
      <div className="piano-scroll">
        <div
          className="piano-canvas"
          style={{ width: 44 + bars * 4 * px, height: height + 25 }}
        >
          <div className="piano-ruler" style={{ left: 44 }}>
            {Array.from({ length: bars }, (_, i) => (
              <span key={i} style={{ left: i * 4 * px }}>
                Bar {Math.round(pageStart / beat / 4) + i + 1}
              </span>
            ))}
          </div>
          <div className="piano-keys" style={{ top: 25 }}>
            {pitches.map((pitch) => {
              return (
                <div
                  key={pitch}
                  className={
                    track.instrument !== 'drums' &&
                    [1, 3, 6, 8, 10].includes(pitch % 12)
                      ? 'black-key'
                      : ''
                  }
                  style={{ height: row }}
                >
                  {track.instrument === 'drums'
                    ? pitch === 36
                      ? 'Kick'
                      : pitch === 38
                        ? 'Snare'
                        : 'Hi-hat'
                    : pitch % 12 === 0
                      ? `C${Math.floor(pitch / 12) - 1}`
                      : ''}
                </div>
              );
            })}
          </div>
          <div
            className="piano-grid"
            style={{
              left: 44,
              top: 25,
              width: bars * 4 * px,
              height,
              backgroundSize: `${px / 4}px ${row}px, ${px}px ${row}px, ${px}px ${row}px`,
            }}
            onDoubleClick={(e) => {
              if (e.target !== e.currentTarget || track.events.length >= 10000)
                return;
              const rect = e.currentTarget.getBoundingClientRect();
              const time =
                (Math.round(((e.clientX - rect.left) / px) * 4) / 4) * beat +
                pageStart;
              const note =
                pitches[
                  Math.max(
                    0,
                    Math.min(
                      pitches.length - 1,
                      Math.floor((e.clientY - rect.top) / row),
                    ),
                  )
                ];
              if (time >= 119.98) return;
              const event = {
                time,
                note,
                duration: Math.min(beat, 120 - time),
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
              setSelected(track.events.length);
              onAudition(next, track.events.length);
            }}
          >
            {notes.map(({ event: original, index }) => {
              const event = draft?.index === index ? draft.event : original;
              return (
                <button
                  key={index}
                  className="piano-note"
                  aria-label={`Note ${index + 1}, pitch ${original.note}, at ${original.time.toFixed(2)} seconds`}
                  aria-pressed={selected === index}
                  style={{
                    left: ((event.time - pageStart) / beat) * px,
                    top: pitches.indexOf(event.note) * row + 1,
                    width: Math.max(
                      12,
                      (Math.min(event.duration, pageStart + span - event.time) /
                        beat) *
                        px,
                    ),
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
                    const delta =
                      (Math.round(((e.clientX - g.x) / px) * 4) / 4) * beat;
                    const pitch = Math.round((g.y - e.clientY) / row);
                    g.moved ||=
                      Math.abs(e.clientX - g.x) > 3 ||
                      Math.abs(e.clientY - g.y) > 3;
                    g.next = {
                      ...g.event,
                      time: g.resize
                        ? g.event.time
                        : Math.max(
                            pageStart,
                            Math.min(
                              pageStart + span - beat / 4,
                              g.event.time + delta,
                            ),
                          ),
                      note: g.resize
                        ? g.event.note
                        : pitches[
                            Math.max(
                              0,
                              Math.min(
                                pitches.length - 1,
                                pitches.indexOf(g.event.note) - pitch,
                              ),
                            )
                          ],
                      duration: g.resize
                        ? Math.max(beat / 4, g.event.duration + delta)
                        : g.event.duration,
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
                    } else if (
                      [
                        'ArrowLeft',
                        'ArrowRight',
                        'ArrowUp',
                        'ArrowDown',
                      ].includes(e.key)
                    ) {
                      e.preventDefault();
                      update(index, {
                        ...original,
                        note:
                          track.instrument === 'drums'
                            ? pitches[
                                Math.max(
                                  0,
                                  Math.min(
                                    pitches.length - 1,
                                    pitches.indexOf(original.note) +
                                      (e.key === 'ArrowUp'
                                        ? -1
                                        : e.key === 'ArrowDown'
                                          ? 1
                                          : 0),
                                  ),
                                )
                              ]
                            : original.note +
                              (e.key === 'ArrowUp'
                                ? 1
                                : e.key === 'ArrowDown'
                                  ? -1
                                  : 0),
                        time:
                          original.time +
                          (!e.shiftKey
                            ? e.key === 'ArrowRight'
                              ? beat / 4
                              : e.key === 'ArrowLeft'
                                ? -beat / 4
                                : 0
                            : 0),
                        duration:
                          original.duration +
                          (e.shiftKey
                            ? e.key === 'ArrowRight'
                              ? beat / 4
                              : e.key === 'ArrowLeft'
                                ? -beat / 4
                                : 0
                            : 0),
                      });
                    }
                  }}
                >
                  <span className="note-grip" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="piano-footer">
        <span>Notes snap into place · double-click empty space to add one</span>
        <button
          className="text-button"
          disabled={pageStart === 0}
          onClick={() => setPage(Math.max(0, page - 1))}
        >
          ← Earlier
        </button>
        <button
          className="text-button"
          disabled={pageStart + span >= track.duration}
          onClick={() => setPage(page + 1)}
        >
          Later →
        </button>
        <button
          className="text-button"
          disabled={!track.events.length}
          onClick={() => onChange(trimQuietEdges(track))}
        >
          Trim empty edges
        </button>
      </div>
    </section>
  );
}
