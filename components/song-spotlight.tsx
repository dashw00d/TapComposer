'use client';
import { useState, type CSSProperties } from 'react';
import { Slider } from './ui/slider';
import {
  ArrowDownToLine,
  AudioLines,
  LoaderCircle,
  Play,
  Square,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui/dialog';
import { instrumentInfo } from '@/lib/music/instruments';
import type { Song, Track } from '@/lib/music/types';

const timeLabel = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export function SongSpotlight({
  song,
  tracks,
  open,
  onOpenChange,
  playing,
  loading,
  position,
  duration,
  onPlay,
  onSeek,
  onSave,
  error,
}: {
  song: Song;
  tracks: Track[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number;
  onPlay: () => void;
  onSeek: (seconds: number) => void;
  onSave: () => void;
  error: string;
}) {
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const instruments = [
    ...new Set(
      tracks
        .filter((t) => !t.muted && t.events.length)
        .map((t) => t.instrument),
    ),
  ];
  const beat = 60 / (song.context?.tempo ?? 100);
  const sections = (song.sections ?? []).map((section, index, all) => {
    const start = all
      .slice(0, index)
      .reduce((sum, previous) => sum + previous.bars * 4 * beat, 0);
    return { ...section, start, end: start + section.bars * 4 * beat };
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="app-dialog spotlight-dialog">
        <div className="spotlight-heading">
          <p className="eyebrow">MADE BY YOU · TAPCOMPOSER</p>
          <DialogTitle className="spotlight-title">{song.name}</DialogTitle>
          <DialogDescription>One little idea. A whole song.</DialogDescription>
        </div>
        <div
          className={`spotlight-record ${playing ? 'is-playing' : ''}`}
          aria-hidden="true"
        >
          <div className="record-grooves">
            <div className="record-label">
              <AudioLines size={48} />
              <span>YOUR ORIGINAL</span>
            </div>
          </div>
        </div>
        <div className="spotlight-band" aria-label="Instruments in this song">
          {instruments.map((instrument) => {
            const info = instrumentInfo(instrument);
            const sounding =
              playing &&
              tracks.some(
                (track) =>
                  !track.muted &&
                  track.instrument === instrument &&
                  track.events.some(
                    (event) =>
                      event.time <= position &&
                      event.time + Math.max(event.duration, 0.12) > position,
                  ),
              );
            return (
              <span
                key={instrument}
                className={sounding ? 'is-sounding' : ''}
                style={{ '--sound-color': info.color } as CSSProperties}
              >
                <i />
                {info.name}
              </span>
            );
          })}
        </div>
        <div className="spotlight-transport">
          <button
            className="button primary spotlight-play"
            onClick={onPlay}
            disabled={loading}
          >
            {loading ? (
              <LoaderCircle className="spin" />
            ) : playing ? (
              <Square size={20} />
            ) : (
              <Play size={22} />
            )}
            {loading
              ? 'Getting ready…'
              : playing
                ? 'Stop playing'
                : 'Play my song'}
          </button>
          <div className="spotlight-seek">
            <Slider
              aria-label="Song playback position"
              min={0}
              max={duration}
              step={0.1}
              value={[seekDraft ?? Math.min(position, duration)]}
              onValueChange={(value) =>
                setSeekDraft(Array.isArray(value) ? value[0] : value)
              }
              onValueCommitted={(value) => {
                setSeekDraft(null);
                onSeek(Array.isArray(value) ? value[0] : value);
              }}
            />
            <div>
              <span>{timeLabel(position)}</span>
              <span>{timeLabel(duration)}</span>
            </div>
          </div>
        </div>
        {sections.length > 0 && (
          <div className="spotlight-sections" aria-label="Jump to a section">
            {sections
              .filter((section) => section.start < duration)
              .map((section) => (
                <button
                  key={section.id}
                  aria-pressed={
                    playing &&
                    position >= section.start &&
                    position < section.end
                  }
                  onClick={() => onSeek(section.start)}
                >
                  {section.name}
                </button>
              ))}
          </div>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <div className="spotlight-footer">
          <button className="text-button" onClick={() => onOpenChange(false)}>
            Back to making music
          </button>
          <button className="button" onClick={onSave}>
            <ArrowDownToLine size={17} /> Save audio
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
