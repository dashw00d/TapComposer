'use client';
import { useRef, useState, type CSSProperties } from 'react';
import { Volume2, VolumeX, X } from 'lucide-react';
import { INSTRUMENTS, instrumentInfo } from '@/lib/music/instruments';
import {
  changeInstrument,
  patternBeats as getPatternBeats,
} from '@/lib/music/composition';
import {
  addClip,
  copyClip,
  moveClip,
  removeClip,
  songClips,
} from '@/lib/music/clips';
import type { ArrangementClip, Song, Track } from '@/lib/music/types';
import { NoteCleanup } from './note-cleanup';

export function SongTimeline({
  song,
  update,
  onPlay,
  onAudition,
  playing,
  position,
  onSeek,
  onMore,
  onUndo,
  canUndo,
}: {
  song: Song;
  update: (change: (song: Song) => Song) => void;
  onPlay: (track: Track) => void;
  onAudition: (track: Track, index: number) => void;
  playing: string | null;
  position: number;
  onSeek: (seconds: number) => void;
  onMore: (id: string) => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const [selection, setSelection] = useState<{
    trackId: string;
    clipId?: string;
  } | null>(null);
  const [draft, setDraft] = useState<ArrangementClip | null>(null);
  const [zoom, setZoom] = useState(12);
  const editor = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    clip: ArrangementClip;
    x: number;
    resize: boolean;
    moved: boolean;
    next: ArrangementClip;
  } | null>(null);
  const clips = songClips(song);
  const track = song.tracks.find((t) => t.id === selection?.trackId);
  const selected = clips.find((c) => c.id === selection?.clipId);
  const beat = 60 / (song.context?.tempo ?? 100);
  const length = Math.min(
    512,
    Math.max(
      32,
      Math.ceil(
        Math.max(
          0,
          ...clips.map((c) => c.startBeat + c.lengthBeats),
          draft ? draft.startBeat + draft.lengthBeats : 0,
        ) / 16,
      ) *
        16 +
        16,
    ),
  );
  function selectPart(next: { trackId: string; clipId?: string }) {
    setSelection(next);
    requestAnimationFrame(() =>
      editor.current?.scrollIntoView?.({
        block: 'nearest',
        behavior: 'smooth',
      }),
    );
  }
  function patchTrack(next: Track) {
    update((s) => ({
      ...s,
      tracks: s.tracks.map((t) => (t.id === next.id ? next : t)),
    }));
  }
  return (
    <section className="playlist" aria-label="Song timeline">
      <div className="playlist-heading">
        <div>
          <strong>Arrange your song</strong>
          <p>Move a block to move the music. Click one to edit its notes.</p>
        </div>
        <div className="playlist-zoom">
          <button
            className="button"
            aria-label="Zoom out timeline"
            disabled={zoom <= 8}
            onClick={() => setZoom(zoom - 4)}
          >
            −
          </button>
          <button
            className="button"
            aria-label="Zoom in timeline"
            disabled={zoom >= 32}
            onClick={() => setZoom(zoom + 4)}
          >
            +
          </button>
        </div>
      </div>
      <div className="playlist-scroll">
        <div className="playlist-canvas" style={{ width: 164 + length * zoom }}>
          <div className="playlist-ruler">
            <span className="lane-label ruler-label">TRACKS / BARS</span>
            <div style={{ width: length * zoom }}>
              {Array.from({ length: length / 4 }, (_, i) => (
                <button
                  key={i}
                  aria-label={`Play from bar ${i + 1}`}
                  style={{ left: i * 4 * zoom, width: 4 * zoom }}
                  onClick={() => onSeek(i * 4 * beat)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
          {song.tracks.map((t) => (
            <div
              key={t.id}
              className={`playlist-row ${t.muted || (song.tracks.some((part) => part.solo && !part.muted) && !t.solo) ? 'lane-muted' : ''}`}
              style={
                {
                  '--part-color': instrumentInfo(t.instrument).color,
                } as CSSProperties
              }
            >
              <div className="lane-label">
                <button
                  className="lane-name"
                  aria-pressed={track?.id === t.id}
                  onClick={() => selectPart({ trackId: t.id })}
                >
                  <strong>{t.name}</strong>
                  <span>
                    {instrumentInfo(t.instrument).name} ·{' '}
                    {t.solo
                      ? 'Listening alone'
                      : t.generated
                        ? 'Backing'
                        : 'Your recording'}
                  </span>
                </button>
                <button
                  className="lane-mute"
                  aria-label={`${t.muted ? 'Unmute' : 'Mute'} ${t.name}`}
                  onClick={() => patchTrack({ ...t, muted: !t.muted })}
                >
                  {t.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
              </div>
              <div
                className="playlist-lane"
                style={{
                  width: length * zoom,
                  backgroundSize: `${zoom}px 100%, ${zoom * 4}px 100%`,
                }}
                onDoubleClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const start =
                    (e.clientX - e.currentTarget.getBoundingClientRect().left) /
                    zoom;
                  update((s) => addClip(s, t.id, start));
                }}
              >
                {clips
                  .filter((c) => c.trackId === t.id)
                  .map((original) => {
                    const clip = draft?.id === original.id ? draft : original;
                    const sourceBeat =
                      60 / (t.sourceTempo ?? song.context?.tempo ?? 100);
                    const patternBeats = getPatternBeats(t, song.context);
                    const preview = Array.from(
                      {
                        length: clip.repeat
                          ? Math.min(
                              32,
                              Math.ceil(clip.lengthBeats / patternBeats),
                            )
                          : 1,
                      },
                      (_, cycle) =>
                        t.events.slice(0, 300).map((n, i) => {
                          const at = cycle * patternBeats + n.time / sourceBeat;
                          return at < clip.lengthBeats ? (
                            <i
                              key={`${cycle}:${i}`}
                              style={{
                                left: `${(at / clip.lengthBeats) * 100}%`,
                                width: `${Math.max(0.6, (Math.min(n.duration / sourceBeat, clip.lengthBeats - at) / clip.lengthBeats) * 100)}%`,
                                top: `${5 + (1 - (n.note % 36) / 36) * 20}px`,
                              }}
                            />
                          ) : null;
                        }),
                    );
                    return (
                      <button
                        key={clip.id}
                        className="music-clip"
                        aria-label={`${t.name}, bar ${+(original.startBeat / 4 + 1).toFixed(2)}, ${+(original.lengthBeats / 4).toFixed(2)} bars`}
                        aria-pressed={selected?.id === clip.id}
                        style={{
                          left: clip.startBeat * zoom,
                          width: Math.max(8, clip.lengthBeats * zoom - 2),
                        }}
                        onClick={() =>
                          selectPart({ trackId: t.id, clipId: clip.id })
                        }
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          e.preventDefault();
                          e.currentTarget.focus();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setSelection({ trackId: t.id, clipId: clip.id });
                          gesture.current = {
                            clip: original,
                            next: original,
                            x: e.clientX,
                            resize:
                              e.clientX >
                              e.currentTarget.getBoundingClientRect().right -
                                10,
                            moved: false,
                          };
                        }}
                        onPointerMove={(e) => {
                          const g = gesture.current;
                          if (!g || g.clip.id !== clip.id) return;
                          const delta =
                            Math.round(((e.clientX - g.x) / zoom) * 4) / 4;
                          g.moved ||= Math.abs(e.clientX - g.x) > 3;
                          const lengthBeats = g.resize
                            ? Math.max(
                                0.25,
                                Math.min(
                                  512,
                                  512 - g.clip.startBeat,
                                  g.clip.lengthBeats + delta,
                                ),
                              )
                            : g.clip.lengthBeats;
                          g.next = {
                            ...g.clip,
                            lengthBeats,
                            startBeat: g.resize
                              ? g.clip.startBeat
                              : Math.max(
                                  0,
                                  Math.min(
                                    512 - lengthBeats,
                                    g.clip.startBeat + delta,
                                  ),
                                ),
                          };
                          setDraft(g.next);
                        }}
                        onPointerUp={(e) => {
                          const g = gesture.current;
                          gesture.current = null;
                          setDraft(null);
                          e.currentTarget.releasePointerCapture(e.pointerId);
                          if (g?.moved)
                            update((s) =>
                              moveClip(
                                s,
                                g.clip.id,
                                g.next.startBeat,
                                g.next.lengthBeats,
                              ),
                            );
                        }}
                        onPointerCancel={() => {
                          gesture.current = null;
                          setDraft(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Delete' || e.key === 'Backspace') {
                            e.preventDefault();
                            update((s) => removeClip(s, clip.id));
                          } else if (
                            e.key === 'ArrowLeft' ||
                            e.key === 'ArrowRight'
                          ) {
                            e.preventDefault();
                            const delta = e.key === 'ArrowRight' ? 1 : -1;
                            update((s) =>
                              moveClip(
                                s,
                                clip.id,
                                clip.startBeat + (e.shiftKey ? 0 : delta),
                                clip.lengthBeats + (e.shiftKey ? delta : 0),
                              ),
                            );
                          }
                        }}
                      >
                        <span className="clip-title">{t.name}</span>
                        <span className="clip-notes" aria-hidden="true">
                          {preview}
                        </span>
                        <span className="clip-grip" />
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
          <div
            className="playlist-playhead"
            style={{ left: 164 + (position / beat) * zoom }}
            aria-hidden="true"
          />
        </div>
      </div>
      <div className="playlist-hint">
        Drag the right edge to shorten or repeat a block. Double-click an empty
        lane to add one.
      </div>
      {track && (
        <div
          ref={editor}
          className="selected-part"
          style={
            {
              '--part-color': instrumentInfo(track.instrument).color,
            } as CSSProperties
          }
        >
          <div className="selected-part-heading">
            <div>
              <strong>{track.name}</strong>
              <span>
                {track.generated
                  ? 'Automatic backing · change it just like your own recording'
                  : 'Your recording'}{' '}
                · edits apply to every block of this part
              </span>
            </div>
            <button
              className="icon-button"
              aria-label="Close note editor"
              onClick={() => setSelection(null)}
            >
              <X size={18} />
            </button>
          </div>
          {selected && (
            <div className="clip-actions">
              <span>
                Block at bar {+(selected.startBeat / 4 + 1).toFixed(2)}
              </span>
              <button
                className="button"
                disabled={
                  clips.length >= 576 ||
                  selected.startBeat + selected.lengthBeats * 2 > 512
                }
                onClick={() => update((s) => copyClip(s, selected.id))}
              >
                Duplicate block
              </button>
              <button
                className="button"
                onClick={() => update((s) => removeClip(s, selected.id))}
              >
                Delete block
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={selected.repeat}
                  onChange={(e) => {
                    const repeat = e.target.checked;
                    update((s) => ({
                      ...s,
                      clips: songClips(s).map((c) =>
                        c.id === selected.id ? { ...c, repeat } : c,
                      ),
                    }));
                  }}
                />{' '}
                Repeat inside block
              </label>
            </div>
          )}
          <div className="sound-choices" aria-label="Instrument">
            <span>Sound</span>
            {INSTRUMENTS.map((instrument) => (
              <button
                key={instrument.id}
                className="button"
                aria-pressed={track.instrument === instrument.id}
                onClick={() => {
                  if (song.context)
                    patchTrack(
                      changeInstrument(track, instrument.id, song.context),
                    );
                }}
              >
                {instrument.name}
              </button>
            ))}
            <button className="text-button" onClick={() => onMore(track.id)}>
              More options
            </button>
          </div>
          <NoteCleanup
            key={`${track.id}:${track.instrument}`}
            track={track}
            context={song.context}
            tempo={song.context?.tempo}
            onChange={patchTrack}
            onPlay={() => onPlay(track)}
            onAudition={onAudition}
            playing={playing === track.id}
            onUndo={onUndo}
            canUndo={canUndo}
          />
        </div>
      )}
    </section>
  );
}
