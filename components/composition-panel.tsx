'use client';
import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Pin,
  Settings2,
  ArrowLeft,
  ArrowRight,
  Copy,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';
import {
  DEFAULT_COMPOSE,
  FEELS,
  composeSong,
  moveSection,
  sectionStart,
  beatSeconds,
} from '@/lib/music/composition';
import { JourneyEditor } from './journey-editor';
import { reorderSection, resizeSection } from '@/lib/music/direct';
import { instrumentInfo } from '@/lib/music/instruments';
import type { Song, SongSection, Feel } from '@/lib/music/types';
interface Props {
  song: Song;
  update: (change: (song: Song) => Song) => void;
  onSeek: (seconds: number) => void;
  position: number;
  onPropose?: (label: string, next: Song, retry?: (song: Song) => Song) => void;
}
export function CompositionPanel({
  song,
  update,
  onSeek,
  position,
  onPropose,
}: Props) {
  const resize = useRef<{
    id: string;
    x: number;
    bars: number;
    next: number;
  } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; bars: number } | null>(
    null,
  );
  const propose = (label: string, next: Song, retry?: (song: Song) => Song) =>
    onPropose ? onPropose(label, next, retry) : update(() => next);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const selectedSection = song.sections?.find(
    (section) => section.id === sectionId,
  );
  const totalBeats = (song.sections ?? []).reduce(
    (sum, s) => sum + s.bars * 4,
    0,
  );
  const settings = { ...DEFAULT_COMPOSE, ...song.compose },
    sections = song.sections ?? [];
  const patch = (id: string, change: (section: SongSection) => SongSection) =>
    update((s) => ({
      ...s,
      sections: s.sections?.map((section) =>
        section.id === id ? change(section) : section,
      ),
    }));
  return (
    <section
      className="composition-panel"
      aria-label="Automatic song arrangement"
    >
      <div className="arranger-heading">
        <div>
          <p className="eyebrow">YOUR IDEA. A WHOLE SONG.</p>
          <h2>Give it somewhere to go.</h2>
        </div>
        <button
          className="button primary"
          disabled={!song.tracks.length}
          onClick={() =>
            propose(
              'Another arrangement',
              composeSong(song, {
                variation: (song.compose?.variation ?? 0) + 1,
              }),
              (previous) =>
                composeSong(song, {
                  variation: (previous.compose?.variation ?? 0) + 1,
                }),
            )
          }
        >
          <RefreshCw size={17} />
          {sections.length ? 'Try another version' : 'Build my song'}
        </button>
      </div>
      <div className="feel-controls">
        <div className="feel-choice">
          <label htmlFor="song-feel">The feeling</label>
          <Select
            value={settings.feel}
            onValueChange={(value) => {
              if (value) update((s) => composeSong(s, { feel: value as Feel }));
            }}
          >
            <SelectTrigger id="song-feel" className="feel-select">
              <SelectValue>
                {FEELS.find((f) => f.id === settings.feel)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {FEELS.map((feel) => (
                <SelectItem key={feel.id} value={feel.id}>
                  {feel.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="macro-control">
          <label htmlFor="energy-control">
            A little calmer <span>More energy</span>
          </label>
          <Slider
            id="energy-control"
            aria-label="Song energy"
            key={`energy-${settings.energy}`}
            defaultValue={[settings.energy * 100]}
            min={20}
            max={100}
            step={10}
            onValueCommitted={(value) =>
              update((s) =>
                composeSong(s, {
                  energy: (Array.isArray(value) ? value[0] : value) / 100,
                }),
              )
            }
          />
        </div>
        <div className="macro-control">
          <label htmlFor="speed-control">
            Take it easy <span>Pick it up</span>
          </label>
          <Slider
            id="speed-control"
            aria-label="Song speed"
            key={`tempo-${song.context?.tempo}`}
            defaultValue={[song.context?.tempo ?? 100]}
            min={55}
            max={170}
            step={1}
            onValueCommitted={(value) =>
              update((s) => ({
                ...s,
                context: {
                  ...(s.context ?? { key: 0, mode: 'major', confidence: 0 }),
                  tempo: Array.isArray(value) ? value[0] : value,
                },
              }))
            }
          />
        </div>
      </div>
      <details className="gentle-details harmony-keep">
        <summary>Keep the harmony</summary>
        <label>
          <Switch
            checked={song.harmonyPinned ?? false}
            onCheckedChange={(harmonyPinned) =>
              update((s) => ({ ...s, harmonyPinned }))
            }
          />{' '}
          Keep these chords when adding ideas or trying another version
        </label>
      </details>
      {!!sections.length && (
        <JourneyEditor
          key={JSON.stringify(sections.map((s) => [s.id, s.energy, s.pinned]))}
          song={song}
          onPropose={propose}
        />
      )}
      <p className="arranger-hint">
        <Sparkles size={15} />
        {FEELS.find((f) => f.id === settings.feel)?.description} Your own
        recordings stay intact.
      </p>
      {sections.length > 0 && (
        <p className="arrangement-help">
          Click a part to bring it in or out. Drag section titles to reorder;
          drag their right edge to change length.
        </p>
      )}
      {sections.length > 0 && (
        <div className="song-map" aria-label="Song sections">
          {sections.map((section, index) => {
            const start =
                sectionStart(song, section.id) * beatSeconds(song.context),
              end = start + section.bars * 4 * beatSeconds(song.context);
            return (
              <div
                className={`section-card ${position >= start && position < end ? 'current-section' : ''}`}
                key={section.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/tapcomposer-section');
                  update((s) => reorderSection(s, id, section.id));
                }}
              >
                <button
                  className="section-seek"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      'text/tapcomposer-section',
                      section.id,
                    );
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => onSeek(start)}
                  title={`Play from ${section.name}`}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>
                    {section.name}
                    {section.pinned ? ' · kept' : ''}
                  </strong>
                  <small>
                    {resizing?.id === section.id
                      ? `${resizing.bars} bars`
                      : `${Math.round(end - start)}s`}
                  </small>
                </button>
                <div className="section-lanes">
                  {song.tracks.map((track) => (
                    <button
                      key={track.id}
                      className={`section-lane ${section.trackIds.includes(track.id) ? 'included' : ''}`}
                      style={
                        {
                          '--part-color': instrumentInfo(track.instrument)
                            .color,
                        } as React.CSSProperties
                      }
                      aria-label={`${section.trackIds.includes(track.id) ? 'Remove' : 'Add'} ${track.name} ${section.trackIds.includes(track.id) ? 'from' : 'to'} ${section.name}`}
                      aria-pressed={section.trackIds.includes(track.id)}
                      onClick={() =>
                        patch(section.id, (current) => ({
                          ...current,
                          trackIds: current.trackIds.includes(track.id)
                            ? current.trackIds.filter((id) => id !== track.id)
                            : [...current.trackIds, track.id],
                        }))
                      }
                    >
                      <i />
                      {track.name}
                    </button>
                  ))}
                </div>
                <div
                  className="section-resize"
                  // A focusable resize handle has separator semantics, unlike a static rule.
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                  role="separator"
                  aria-valuenow={section.bars}
                  aria-valuemin={2}
                  aria-valuemax={32}
                  aria-orientation="vertical"
                  aria-label={`Resize ${section.name}`}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                      e.preventDefault();
                      update((s) =>
                        resizeSection(
                          s,
                          section.id,
                          section.bars + (e.key === 'ArrowRight' ? 2 : -2),
                        ),
                      );
                    }
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    resize.current = {
                      id: section.id,
                      x: e.clientX,
                      bars: section.bars,
                      next: section.bars,
                    };
                  }}
                  onPointerMove={(e) => {
                    const r = resize.current;
                    if (!r || r.id !== section.id) return;
                    const next = resizeSection(
                      song,
                      section.id,
                      r.bars + Math.round((e.clientX - r.x) / 24) * 2,
                    ).sections!.find((s) => s.id === section.id)!.bars;
                    r.next = next;
                    setResizing({ id: section.id, bars: next });
                  }}
                  onPointerUp={(e) => {
                    const r = resize.current;
                    if (!r) return;
                    resize.current = null;
                    setResizing(null);
                    e.currentTarget.releasePointerCapture(e.pointerId);
                    if (r.next !== r.bars)
                      update((s) => resizeSection(s, r.id, r.next));
                  }}
                  onPointerCancel={() => {
                    resize.current = null;
                    setResizing(null);
                  }}
                />
                <div className="section-actions">
                  <button
                    aria-label={`${section.pinned ? 'Release' : 'Keep'} ${section.name}`}
                    aria-pressed={section.pinned ?? false}
                    title="Keep this section and its parts during automatic changes"
                    onClick={() =>
                      patch(section.id, (s) => ({ ...s, pinned: !s.pinned }))
                    }
                  >
                    <Pin size={15} />
                  </button>
                  <button
                    aria-label={`Shape ${section.name}`}
                    onClick={() => setSectionId(section.id)}
                  >
                    <Settings2 size={15} />
                  </button>
                  <button
                    aria-label={`Move ${section.name} earlier`}
                    disabled={index === 0}
                    onClick={() =>
                      update((s) => moveSection(s, section.id, -1))
                    }
                  >
                    <ArrowLeft size={15} />
                  </button>
                  <button
                    aria-label={`Move ${section.name} later`}
                    disabled={index === sections.length - 1}
                    onClick={() => update((s) => moveSection(s, section.id, 1))}
                  >
                    <ArrowRight size={15} />
                  </button>
                  <button
                    aria-label={`Shorten ${section.name}`}
                    disabled={section.bars <= 2}
                    onClick={() =>
                      update((s) =>
                        resizeSection(s, section.id, section.bars - 2),
                      )
                    }
                  >
                    <Minus size={15} />
                  </button>
                  <button
                    aria-label={`Lengthen ${section.name}`}
                    disabled={section.bars >= 32 || totalBeats + 8 > 512}
                    onClick={() =>
                      update((s) =>
                        resizeSection(s, section.id, section.bars + 2),
                      )
                    }
                  >
                    <Plus size={15} />
                  </button>
                  <button
                    aria-label={`Duplicate ${section.name}`}
                    disabled={
                      sections.length >= 12 ||
                      totalBeats + section.bars * 4 > 512
                    }
                    onClick={() =>
                      update((s) => {
                        const next = [...(s.sections ?? [])];
                        next.splice(index + 1, 0, {
                          ...section,
                          id: crypto.randomUUID(),
                          name: `${section.name} again`,
                        });
                        return { ...s, sections: next };
                      })
                    }
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    aria-label={`Remove ${section.name}`}
                    disabled={sections.length <= 1}
                    onClick={() =>
                      update((s) => ({
                        ...s,
                        sections: s.sections?.filter(
                          (current) => current.id !== section.id,
                        ),
                      }))
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Dialog
        open={!!selectedSection}
        onOpenChange={(open) => {
          if (!open) setSectionId(null);
        }}
      >
        <DialogContent className="app-dialog section-editor">
          <DialogTitle className="dialog-title">Shape this section</DialogTitle>
          <DialogDescription>
            Decide when each ingredient comes in. The song stays in time.
          </DialogDescription>
          {selectedSection && (
            <>
              <label className="field-label" htmlFor="section-name">
                Section name
              </label>
              <input
                id="section-name"
                className="part-name-input"
                defaultValue={selectedSection.name}
                key={selectedSection.id}
                maxLength={40}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name)
                    patch(selectedSection.id, (section) => ({
                      ...section,
                      name,
                    }));
                }}
              />
              {song.tracks
                .filter((track) => selectedSection.trackIds.includes(track.id))
                .map((track) => {
                  const setting = selectedSection.parts?.[track.id] ?? {
                    offsetBeats: 0,
                    repeat: true,
                    transpose: 0,
                  };
                  const set = (changes: Partial<typeof setting>) =>
                    patch(selectedSection.id, (section) => ({
                      ...section,
                      parts: {
                        ...section.parts,
                        [track.id]: { ...setting, ...changes },
                      },
                    }));
                  return (
                    <div className="section-part-edit" key={track.id}>
                      <strong>{track.name}</strong>
                      <label htmlFor={`entry-${track.id}`}>
                        Comes in{' '}
                        {setting.offsetBeats === 0
                          ? 'at the start'
                          : `after ${Math.round(setting.offsetBeats * beatSeconds(song.context))} seconds`}
                      </label>
                      <Slider
                        id={`entry-${track.id}`}
                        aria-label={`${track.name} entrance`}
                        key={`${track.id}-${setting.offsetBeats}`}
                        defaultValue={[setting.offsetBeats]}
                        min={0}
                        max={selectedSection.bars * 4 - 1}
                        step={1}
                        onValueCommitted={(value) =>
                          set({
                            offsetBeats: Array.isArray(value)
                              ? value[0]
                              : value,
                          })
                        }
                      />
                      <div className="section-fades">
                        <label htmlFor={`fade-in-${track.id}`}>
                          Fade in ·{' '}
                          {setting.fadeInBeats
                            ? `${(setting.fadeInBeats * beatSeconds(song.context)).toFixed(1)}s`
                            : 'off'}
                          <Slider
                            id={`fade-in-${track.id}`}
                            aria-label={`${track.name} fade in`}
                            key={`in-${setting.fadeInBeats ?? 0}`}
                            defaultValue={[setting.fadeInBeats ?? 0]}
                            min={0}
                            max={Math.min(16, selectedSection.bars * 4)}
                            step={1}
                            onValueCommitted={(v) =>
                              set({ fadeInBeats: Array.isArray(v) ? v[0] : v })
                            }
                          />
                        </label>
                        <label htmlFor={`fade-out-${track.id}`}>
                          Fade out ·{' '}
                          {setting.fadeOutBeats
                            ? `${(setting.fadeOutBeats * beatSeconds(song.context)).toFixed(1)}s`
                            : 'off'}
                          <Slider
                            id={`fade-out-${track.id}`}
                            aria-label={`${track.name} fade out`}
                            key={`out-${setting.fadeOutBeats ?? 0}`}
                            defaultValue={[setting.fadeOutBeats ?? 0]}
                            min={0}
                            max={Math.min(16, selectedSection.bars * 4)}
                            step={1}
                            onValueCommitted={(v) =>
                              set({ fadeOutBeats: Array.isArray(v) ? v[0] : v })
                            }
                          />
                        </label>
                      </div>
                      <div className="section-part-options">
                        <label htmlFor={`part-repeat-${track.id}`}>
                          <Switch
                            id={`part-repeat-${track.id}`}
                            checked={setting.repeat}
                            onCheckedChange={(repeat) => set({ repeat })}
                          />{' '}
                          Keep going
                        </label>
                        {track.instrument !== 'drums' && (
                          <Select
                            value={String(setting.transpose)}
                            onValueChange={(value) => {
                              if (value !== null)
                                set({ transpose: Number(value) });
                            }}
                          >
                            <SelectTrigger
                              aria-label={`${track.name} register`}
                            >
                              <SelectValue>
                                {setting.transpose < 0
                                  ? 'Lower'
                                  : setting.transpose > 0
                                    ? 'Higher'
                                    : 'Original range'}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="-12">Lower</SelectItem>
                              <SelectItem value="0">Original range</SelectItem>
                              <SelectItem value="12">Higher</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                  );
                })}
            </>
          )}
        </DialogContent>
      </Dialog>
      {!sections.length && (
        <div className="arrangement-empty">
          Keep a tap or a hum. We’ll build the rest around it.
        </div>
      )}
    </section>
  );
}
export function MixControls({
  song,
  update,
}: {
  song: Song;
  update: Props['update'];
}) {
  return (
    <div className="mix-panel">
      <p className="eyebrow">A LITTLE BALANCE</p>
      {song.tracks.map((track) => (
        <div className="mix-row" key={track.id}>
          <span>{track.name}</span>
          <Slider
            aria-label={`${track.name} level`}
            key={`${track.id}-volume-${track.volume}`}
            defaultValue={[(track.volume ?? 1) * 100]}
            min={0}
            max={150}
            step={5}
            onValueCommitted={(value) =>
              update((s) => ({
                ...s,
                tracks: s.tracks.map((t) =>
                  t.id === track.id
                    ? {
                        ...t,
                        volume: (Array.isArray(value) ? value[0] : value) / 100,
                      }
                    : t,
                ),
              }))
            }
          />
          <Slider
            aria-label={`${track.name} left right balance`}
            key={`${track.id}-pan-${track.pan}`}
            defaultValue={[track.pan ?? 0]}
            min={-1}
            max={1}
            step={0.1}
            onValueCommitted={(value) =>
              update((s) => ({
                ...s,
                tracks: s.tracks.map((t) =>
                  t.id === track.id
                    ? { ...t, pan: Array.isArray(value) ? value[0] : value }
                    : t,
                ),
              }))
            }
          />
          <label htmlFor={`solo-${track.id}`}>
            Only this{' '}
            <Switch
              id={`solo-${track.id}`}
              checked={track.solo ?? false}
              onCheckedChange={(solo) =>
                update((s) => ({
                  ...s,
                  tracks: s.tracks.map((t) =>
                    t.id === track.id ? { ...t, solo } : t,
                  ),
                }))
              }
            />
          </label>
        </div>
      ))}
      <div className="master-row">
        <label htmlFor="master-volume">Everything</label>
        <Slider
          id="master-volume"
          aria-label="Overall volume"
          key={`master-${song.masterVolume}`}
          defaultValue={[(song.masterVolume ?? 0.85) * 100]}
          min={0}
          max={100}
          onValueCommitted={(value) =>
            update((s) => ({
              ...s,
              masterVolume: (Array.isArray(value) ? value[0] : value) / 100,
            }))
          }
        />
      </div>
    </div>
  );
}
