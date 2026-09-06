'use client';
import {
  createElement,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import {
  AudioLines,
  Guitar,
  Music2,
  Waves,
  Undo2,
  Redo2,
  SlidersHorizontal,
  Upload,
  Copy,
  ArrowUpRight,
  Check,
  Download,
  Drum,
  FolderOpen,
  Headphones,
  LoaderCircle,
  Mic,
  MoreHorizontal,
  Piano,
  Play,
  Plus,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';
import { CompositionPanel, MixControls } from './composition-panel';
import { useSongHistory } from '@/hooks/use-song-history';
import { INSTRUMENTS, instrumentInfo } from '@/lib/music/instruments';
import {
  arrangedTracks,
  patternTracks,
  changeInstrument,
  keepIdea,
} from '@/lib/music/composition';
import { exportProject, importProject } from '@/lib/music/project';
import { exportMidi } from '@/lib/music/midi';
import { Switch } from '@/components/ui/switch';
import { AudioEngine } from '@/lib/music/audio';
import { microphoneError } from '@/lib/music/capture';
import { makeDemoSong } from '@/lib/music/demo';
import { PremiumStudio } from './premium-studio';
import { songFingerprint } from '@/lib/premium/client';
import { smoothTrack, songDuration } from '@/lib/music/resolve';
import {
  download,
  listSongs,
  safeFilename,
  saveSong,
} from '@/lib/music/storage';
import {
  MAX_TRACKS,
  newSong,
  type Instrument,
  type Song,
  type Track,
} from '@/lib/music/types';
import { Recorder } from './recorder';

export default function Composer() {
  const history = useSongHistory();
  const { song, load: loadSong } = history;
  const [view, setView] = useState<'song' | 'ideas'>('song');
  const [mixOpen, setMixOpen] = useState(false);
  const [seekAt, setSeekAt] = useState(0);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const projectInput = useRef<HTMLInputElement | null>(null);
  const [saveState, setSaveState] = useState('Opening your songs…');
  const [error, setError] = useState('');
  const [recorder, setRecorder] = useState<{
    instrument: Instrument;
    replaceId?: string;
  } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playedDuration, setPlayedDuration] = useState(0);
  const [library, setLibrary] = useState<Song[] | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [credits, setCredits] = useState(false);
  const [audioEngine] = useState(() => new AudioEngine());
  const playback = useRef<{ startAt: number; duration: number } | null>(null);
  const saves = useRef<Promise<void>>(Promise.resolve());
  const currentSongId = useRef('');
  const latestSong = useRef<Song | null>(null);
  const mounted = useRef(true);
  const exportWorker = useRef<Worker | null>(null);
  const playSerial = useRef(0);
  function getEngine() {
    return audioEngine;
  }
  useEffect(() => {
    mounted.current = true;
    listSongs()
      .then((songs) => {
        if (mounted.current) loadSong(songs[0] ?? newSong());
      })
      .catch(() => {
        if (mounted.current) {
          loadSong(newSong());
          setError(
            'Browser storage is unavailable. You can still play, but download your recordings before leaving.',
          );
        }
      });
    return () => {
      mounted.current = false;
      exportWorker.current?.terminate();
      void audioEngine.close();
    };
    // Initial load uses the history reducer dispatch.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [audioEngine]);
  useEffect(() => {
    if (!song) return;
    currentSongId.current = song.id;
    latestSong.current = song;
    const snapshot = song;
    saves.current = saves.current
      .catch(() => {})
      .then(() => saveSong(snapshot))
      .then(() => {
        if (mounted.current && currentSongId.current === snapshot.id)
          setSaveState('Saved in this browser');
      })
      .catch(() => {
        if (mounted.current) {
          setSaveState('Not saved');
          setError(
            'Your song could not be saved in this browser. Download your audio and original recordings before leaving.',
          );
        }
      });
  }, [song]);
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => {
      const p = playback.current;
      if (p)
        setProgress(
          Math.max(
            0,
            ((audioEngine.currentTime - p.startAt) % p.duration) / p.duration,
          ),
        );
    }, 45);
    return () => clearInterval(interval);
  }, [playing, audioEngine]);
  function updateSong(change: (song: Song) => Song) {
    setSaveState('Saving…');
    if (song) {
      stop();
      history.edit(change(song));
    }
  }
  function updateMusic(change: (song: Song) => Song) {
    if (!song) return;
    const current = playback.current;
    const oldBeat = 60 / (song.context?.tempo ?? 100);
    const at = current
      ? Math.max(
          0,
          (audioEngine.currentTime - current.startAt) % current.duration,
        )
      : 0;
    const next = change(song);
    const resume = playing === 'all';
    updateSong(() => next);
    if (resume) {
      const prepared =
        view === 'song' ? arrangedTracks(next) : patternTracks(next);
      const nextAt = ((at / oldBeat) * 60) / (next.context?.tempo ?? 100);
      void play(
        prepared,
        'all',
        Math.min(nextAt, Math.max(0, songDuration(prepared) - 0.1)),
        true,
      );
    }
  }
  function stop() {
    playSerial.current++;
    audioEngine.stop();
    setPlaying(null);
    setLoading(false);
    playback.current = null;
    setProgress(0);
  }
  async function play(
    tracks: Track[],
    id: string,
    offset = 0,
    restart = false,
  ) {
    if (!restart && playing === id && offset === 0) {
      stop();
      return;
    }
    stop();
    setSeekAt(offset);
    const token = playSerial.current;
    setError('');
    setLoading(true);
    try {
      const p = await getEngine().play(
        tracks,
        id === 'all' && !!song?.repeat,
        () => {
          if (mounted.current) setPlaying(null);
        },
        undefined,
        offset,
      );
      if (token !== playSerial.current || !mounted.current) return;
      playback.current = p;
      setPlayedDuration(p?.duration ?? 0);
      setPlaying(p ? id : null);
    } catch (e) {
      if (token === playSerial.current) setError(microphoneError(e));
    } finally {
      if (token === playSerial.current) setLoading(false);
    }
  }
  function openRecorder(instrument: Instrument, replaceId?: string) {
    if (!song) return;
    if (!replaceId && song.tracks.length >= MAX_TRACKS) {
      setError(
        'This song has 24 parts. Remove one or start a new song to add more.',
      );
      return;
    }
    stop();
    setDetailId(null);
    setRecorder({ instrument, replaceId });
  }
  function keep(track: Track, context: NonNullable<Song['context']>) {
    updateSong((s) => keepIdea(s, track, context));
    setRecorder(null);
    setView('song');
  }
  function patchTrack(id: string, change: (track: Track) => Track) {
    stop();
    updateSong((s) => ({
      ...s,
      tracks: s.tracks.map((t) => (t.id === id ? change(t) : t)),
    }));
  }
  async function openLibrary() {
    setError('');
    try {
      await saves.current;
      setLibrary(await listSongs());
    } catch {
      setError('Saved songs could not be opened. Please try again.');
    }
  }
  async function exportAudio(format: 'wav' | 'mp3') {
    if (!song) return;
    stop();
    setExporting(true);
    setError('');
    try {
      let blob: Blob;
      if (format === 'wav')
        blob = await getEngine().exportWav(arrangedTracks(song));
      else {
        const buffer = await getEngine().render(arrangedTracks(song));
        const left = buffer.getChannelData(0).slice(),
          right = buffer.getChannelData(1).slice();
        blob = await new Promise<Blob>((resolve, reject) => {
          const worker = new Worker(
            new URL('../lib/music/export.worker.ts', import.meta.url),
            { type: 'module' },
          );
          exportWorker.current = worker;
          const timeout = setTimeout(() => {
            worker.terminate();
            reject(new Error('MP3 export took too long. Try WAV instead.'));
          }, 60000);
          const finish = () => {
            clearTimeout(timeout);
            worker.terminate();
            exportWorker.current = null;
          };
          worker.onmessage = (e) => {
            finish();
            if (e.data.error) reject(new Error(e.data.error));
            else resolve(e.data.blob);
          };
          worker.onerror = () => {
            finish();
            reject(new Error('MP3 export failed. Try saving a WAV instead.'));
          };
          worker.postMessage({ left, right, rate: buffer.sampleRate }, [
            left.buffer,
            right.buffer,
          ]);
        });
      }
      if (mounted.current) {
        download(blob, `${safeFilename(song.name)}.${format}`);
        setExportOpen(false);
      }
    } catch (e) {
      if (mounted.current) setError(microphoneError(e));
    } finally {
      if (mounted.current) setExporting(false);
    }
  }
  async function demo() {
    if (!song || song.tracks.length) return;
    const composed = makeDemoSong(song);
    updateSong(() => composed);
    let premium = true;
    try {
      premium = localStorage.getItem('tapcomposer-service') !== 'free';
    } catch {}
    if (premium) {
      try {
        const response = await fetch('/demo/studio-example.wav');
        if (
          response.ok &&
          response.headers.get('Content-Type')?.includes('audio/')
        ) {
          const audio = await response.blob();
          // The example is a real ACE-Step rendering of this exact musical arrangement.
          if (mounted.current && currentSongId.current === composed.id) {
            const latest = latestSong.current ?? composed;
            updateSong(() => ({
              ...latest,
              premiumTakes: [
                {
                  id: 'premium-example',
                  createdAt: Date.now(),
                  duration: songDuration(arrangedTracks(composed)) + 0.7,
                  fingerprint: songFingerprint(composed),
                  audio,
                },
              ],
            }));
          }
          return;
        }
      } catch {
        /* The editable example remains usable without the service or asset. */
      }
    }
    void play(arrangedTracks(composed), 'all');
  }
  const tracks = song?.tracks ?? [],
    detail = tracks.find((t) => t.id === detailId);
  const transportTracks = song
    ? view === 'song'
      ? arrangedTracks(song)
      : patternTracks(song)
    : [];
  const duration = songDuration(transportTracks),
    canPlay = transportTracks.some((t) => !t.muted && t.events.length);
  const position = playing ? progress * playedDuration : seekAt;
  const icons = {
    piano: Piano,
    drums: Drum,
    bass: Music2,
    guitar: Guitar,
    strings: Waves,
    synth: AudioLines,
  };
  async function projectDownload() {
    if (!song) return;
    try {
      download(
        await exportProject(song),
        `${safeFilename(song.name)}.tapcomposer.json`,
      );
    } catch (e) {
      setError(microphoneError(e));
    }
  }
  async function projectUpload(file: File) {
    try {
      const imported = await importProject(file);
      stop();
      loadSong(imported);
      setLibrary(null);
    } catch (e) {
      setError(microphoneError(e));
    }
  }
  const keyboard = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (
      target.closest(
        'input,textarea,select,[role="dialog"],[role="slider"],[contenteditable="true"]',
      )
    )
      return;
    if (
      event.code === 'Space' &&
      !event.repeat &&
      !target.closest('button,a,[role="button"]')
    ) {
      event.preventDefault();
      void play(transportTracks, 'all');
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      stop();
      if (event.shiftKey) history.redo();
      else history.undo();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void projectDownload();
    }
    if (event.key === 'Escape') stop();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyboard(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <AudioLines /> TapComposer
          <span className="edition">YOUR LITTLE STUDIO</span>
        </Link>
        <div className="topbar-actions">
          <output className="local-status">
            <i /> {saveState}
          </output>
          <button
            className="icon-button"
            aria-label="Open saved songs"
            title="Your songs"
            onClick={openLibrary}
          >
            <FolderOpen size={21} />
          </button>
        </div>
      </header>
      <main className="workspace studio-workspace">
        <div className="intro">
          <div>
            <p className="eyebrow">A LITTLE MUSIC, ALL YOURS</p>
            <h1>A song starts with you.</h1>
            <p>Tap or hum an idea. We’ll help it become a song.</p>
          </div>
          <span className="intro-note">
            No wrong notes.
            <br />
            No lessons needed.
          </span>
        </div>
        {error && (
          <div className="error-box page-error" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss message" onClick={() => setError('')}>
              <X size={18} />
            </button>
          </div>
        )}
        <section
          className="instrument-grid studio-instruments"
          aria-label="Choose an instrument"
        >
          {INSTRUMENTS.map((instrument) => {
            const Icon = icons[instrument.id];
            return (
              <button
                key={instrument.id}
                className={`instrument-card ${instrument.id}`}
                style={{ background: instrument.color }}
                disabled={!song}
                onClick={() => openRecorder(instrument.id)}
              >
                <div className="instrument-top">
                  <Icon />
                  <Plus size={17} />
                </div>
                <h2>{instrument.name}</h2>
                <p>{instrument.description}</p>
                <span className="card-action">
                  Tap or hum <ArrowUpRight size={15} />
                </span>
              </button>
            );
          })}
        </section>
        <section className="song-section" aria-label="Your song">
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR WORK IN PLAY</p>
              <input
                className="song-name"
                aria-label="Song name"
                key={song?.id ?? 'loading'}
                defaultValue={song?.name ?? 'My little song'}
                maxLength={60}
                disabled={!song}
                onBlur={(e) => {
                  const name = e.target.value.trim() || 'My little song';
                  e.target.value = name;
                  if (name !== song?.name) updateSong((s) => ({ ...s, name }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            </div>
            <button
              className="button primary"
              disabled={!canPlay || loading}
              onClick={() => play(transportTracks, 'all')}
            >
              {loading ? (
                <LoaderCircle className="spin" size={18} />
              ) : playing === 'all' ? (
                <Square size={17} />
              ) : (
                <Play size={18} />
              )}{' '}
              {loading
                ? 'Getting ready…'
                : playing === 'all'
                  ? 'Stop playing'
                  : view === 'song'
                    ? 'Play my song'
                    : 'Play my ideas'}
            </button>
          </div>
          <div className="studio-toolbar">
            <div className="view-buttons">
              <button
                aria-pressed={view === 'song'}
                onClick={() => {
                  stop();
                  setSeekAt(0);
                  setView('song');
                }}
              >
                The song
              </button>
              <button
                aria-pressed={view === 'ideas'}
                onClick={() => {
                  stop();
                  setSeekAt(0);
                  setView('ideas');
                }}
              >
                The ingredients
              </button>
            </div>
            <div className="history-actions">
              <button
                className="icon-button"
                aria-label="Undo"
                title="Undo · Ctrl/⌘ Z"
                disabled={!history.canUndo}
                onClick={() => {
                  stop();
                  history.undo();
                }}
              >
                <Undo2 size={19} />
              </button>
              <button
                className="icon-button"
                aria-label="Redo"
                title="Redo · Ctrl/⌘ Shift Z"
                disabled={!history.canRedo}
                onClick={() => {
                  stop();
                  history.redo();
                }}
              >
                <Redo2 size={19} />
              </button>
              <button
                className="button"
                disabled={!tracks.length}
                onClick={() => setMixOpen(!mixOpen)}
              >
                <SlidersHorizontal size={17} /> Balance
              </button>
            </div>
          </div>
          {tracks.length > 0 && (
            <div className="transport-line">
              <span>
                {Math.floor(position / 60)}:
                {String(Math.floor(position % 60)).padStart(2, '0')}
              </span>
              <Slider
                aria-label="Playback position"
                value={[
                  seekDraft ?? (duration ? (position / duration) * 100 : 0),
                ]}
                onValueChange={(value) =>
                  setSeekDraft(Array.isArray(value) ? value[0] : value)
                }
                min={0}
                max={100}
                onValueCommitted={(value) => {
                  setSeekDraft(null);
                  const offset =
                    ((Array.isArray(value) ? value[0] : value) / 100) *
                    duration;
                  void play(
                    transportTracks,
                    'all',
                    Math.min(offset, Math.max(0, duration - 0.1)),
                    true,
                  );
                }}
              />
              <span>
                {Math.floor(duration / 60)}:
                {String(Math.floor(duration % 60)).padStart(2, '0')}
              </span>
            </div>
          )}
          {song && tracks.length > 0 && view === 'song' && (
            <CompositionPanel
              song={song}
              update={updateMusic}
              onSeek={(seconds) =>
                void play(arrangedTracks(song), 'all', seconds, true)
              }
              position={position}
            />
          )}
          {song && (
            <PremiumStudio
              key={song.id}
              song={song}
              engine={audioEngine}
              onBeforePlay={stop}
              originalPlaying={!!playing}
              onKeep={(take) =>
                updateSong((s) => ({
                  ...s,
                  premiumTakes: [take, ...(s.premiumTakes ?? [])].slice(0, 3),
                }))
              }
            />
          )}
          {song && mixOpen && <MixControls song={song} update={updateMusic} />}
          {tracks.length === 0 ? (
            <div className="empty-song">
              <AudioLines size={38} />
              <h3>A little quiet in here.</h3>
              <p>Pick an instrument above. Your song starts with you.</p>
              <button
                className="text-button example-button"
                disabled={!song}
                onClick={demo}
              >
                Or hear a little example <Play size={14} />
              </button>
            </div>
          ) : (
            <>
              <div className="track-list studio-track-list">
                {tracks.map((track) => (
                  <div
                    key={track.id}
                    className={`track-row ${track.muted ? 'muted' : ''}`}
                  >
                    <button
                      className={`track-icon ${track.instrument}`}
                      style={{
                        background: instrumentInfo(track.instrument).color,
                      }}
                      aria-label={`Listen to ${track.name}`}
                      disabled={track.muted || loading}
                      onClick={() =>
                        play(
                          song
                            ? patternTracks({ ...song, tracks: [track] })
                            : [track],
                          track.id,
                        )
                      }
                    >
                      {playing === track.id ? (
                        <Square size={20} />
                      ) : (
                        createElement(icons[track.instrument], { size: 24 })
                      )}
                    </button>
                    <div className="track-info">
                      <button
                        className="track-name"
                        onClick={() => setDetailId(track.id)}
                      >
                        {track.name}
                      </button>
                      <span>
                        {track.generated
                          ? 'Arranged for you'
                          : track.intent.source === 'hum'
                            ? 'Your melody'
                            : track.intent.source === 'touch'
                              ? 'Your taps'
                              : 'Your rhythm'}
                        {track.smoother ? ' · Smoothed' : ''}
                      </span>
                    </div>
                    <button
                      className="track-strip"
                      aria-label={`Open ${track.name}`}
                      onClick={() => setDetailId(track.id)}
                    >
                      <div className="note-strip" aria-hidden="true">
                        {track.events.map((e, i) => (
                          <i
                            key={i}
                            style={{
                              left: `${(e.time / track.duration) * 96}%`,
                              width: `${Math.max(0.8, (e.duration / track.duration) * 96)}%`,
                              height:
                                track.instrument === 'piano'
                                  ? '7px'
                                  : `${12 + e.velocity * 22}px`,
                              top:
                                track.instrument === 'piano'
                                  ? `${12 + ((84 - e.note) / 48) * 65}%`
                                  : '25%',
                              background: instrumentInfo(track.instrument)
                                .color,
                            }}
                          />
                        ))}
                        {(playing === 'all' || playing === track.id) && (
                          <b
                            className="playhead"
                            style={{ left: `${progress * 100}%` }}
                          />
                        )}
                      </div>
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${track.name}`}
                      title={track.muted ? 'Turn sound on' : 'Turn sound off'}
                      onClick={() =>
                        patchTrack(track.id, (t) => ({ ...t, muted: !t.muted }))
                      }
                    >
                      {track.muted ? (
                        <VolumeX size={19} />
                      ) : (
                        <Volume2 size={19} />
                      )}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Options for ${track.name}`}
                      onClick={() => setDetailId(track.id)}
                    >
                      <MoreHorizontal size={21} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="song-controls">
                <label className="repeat-control" htmlFor="repeat-song">
                  <Switch
                    id="repeat-song"
                    checked={song?.repeat ?? false}
                    onCheckedChange={(repeat) => {
                      stop();
                      updateSong((s) => ({ ...s, repeat }));
                    }}
                  />
                  <span>Keep repeating</span>
                </label>
                <span className="duration">
                  {tracks.length} {tracks.length === 1 ? 'part' : 'parts'} ·{' '}
                  {Math.ceil(duration)} seconds
                </span>
                <button
                  className="button export-button"
                  onClick={() => setExportOpen(true)}
                  disabled={!canPlay}
                >
                  <Download size={17} /> Save audio
                </button>
              </div>
            </>
          )}
        </section>
        <footer>
          <span>Made by you. A little help from TapComposer.</span>
          <button className="footer-link" onClick={() => setCredits(true)}>
            Sound credits & privacy
          </button>
        </footer>
      </main>
      <input
        type="file"
        ref={projectInput}
        accept=".json,.tapcomposer.json"
        className="sr-only"
        aria-label="Import TapComposer project"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void projectUpload(file);
          e.target.value = '';
        }}
      />
      {song && recorder && (
        <Recorder
          key={`${recorder.instrument}-${recorder.replaceId ?? 'new'}`}
          {...recorder}
          song={song}
          engine={audioEngine}
          onClose={() => setRecorder(null)}
          onKeep={keep}
        />
      )}
      <Dialog
        open={library !== null}
        onOpenChange={(open) => {
          if (!open) setLibrary(null);
        }}
      >
        <DialogContent className="app-dialog">
          <DialogTitle className="dialog-title">Your little songs</DialogTitle>
          <DialogDescription>
            Saved on this device, in this browser.
          </DialogDescription>
          <button
            className="button primary full"
            onClick={() => {
              stop();
              loadSong(newSong());
              setLibrary(null);
            }}
          >
            <Plus size={18} /> New song
          </button>
          <button
            className="button full"
            onClick={() => projectInput.current?.click()}
          >
            <Upload size={18} /> Open a project file
          </button>
          <div className="saved-songs">
            {library?.map((s) => (
              <button
                key={s.id}
                className="saved-song"
                onClick={() => {
                  stop();
                  loadSong(s);
                  setLibrary(null);
                }}
              >
                <div>
                  <strong>{s.name}</strong>
                  <span>
                    {s.tracks.length} parts ·{' '}
                    {new Date(s.updatedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
                {s.id === song?.id ? (
                  <Check size={20} />
                ) : (
                  <ArrowUpRight size={20} />
                )}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={exportOpen}
        onOpenChange={(open) => {
          if (!exporting) setExportOpen(open);
        }}
      >
        <DialogContent className="app-dialog" showCloseButton={!exporting}>
          <DialogTitle className="dialog-title">
            Take your song with you.
          </DialogTitle>
          <DialogDescription>
            Save one full pass of your song. Only parts with their sound on are
            included.
          </DialogDescription>
          <button
            className="export-option"
            disabled={exporting}
            onClick={() => void projectDownload()}
          >
            <div>
              <strong>Editable project</strong>
              <span>Your song, arrangement, and original recordings.</span>
            </div>
            <Download />
          </button>
          <button
            className="export-option"
            disabled={exporting}
            onClick={() => {
              if (song)
                download(exportMidi(song), `${safeFilename(song.name)}.mid`);
            }}
          >
            <div>
              <strong>MIDI</strong>
              <span>Take the notes into another music app.</span>
            </div>
            <Download />
          </button>
          <button
            className="export-option"
            disabled={exporting}
            onClick={() => exportAudio('mp3')}
          >
            <div>
              <strong>MP3</strong>
              <span>A smaller file. Easy to send and share.</span>
            </div>
            <Download />
          </button>
          <button
            className="export-option"
            disabled={exporting}
            onClick={() => exportAudio('wav')}
          >
            <div>
              <strong>WAV</strong>
              <span>Full-quality audio. Keep every detail.</span>
            </div>
            <Download />
          </button>
          {exporting && (
            <output className="processing-message">
              <LoaderCircle className="spin" size={18} /> Making your audio…
            </output>
          )}
          {error && (
            <p className="error-box" role="alert">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      >
        <DialogContent className="app-dialog">
          <DialogTitle className="dialog-title">{detail?.name}</DialogTitle>
          <DialogDescription>
            Your part, just the way you want it.
          </DialogDescription>
          {detail && (
            <div className="detail-actions">
              <label className="field-label" htmlFor="part-name">
                Name this idea
              </label>
              <input
                id="part-name"
                className="part-name-input"
                key={detail.id}
                defaultValue={detail.name}
                maxLength={60}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== detail.name)
                    patchTrack(detail.id, (t) => ({ ...t, name }));
                }}
              />
              <Select
                value={detail.instrument}
                onValueChange={(value) => {
                  if (value)
                    patchTrack(detail.id, (t) =>
                      changeInstrument(t, value as Instrument, song!.context!),
                    );
                }}
              >
                <SelectTrigger className="full" aria-label="Change instrument">
                  <SelectValue>
                    {instrumentInfo(detail.instrument).name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {INSTRUMENTS.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                className="button full"
                disabled={tracks.length >= MAX_TRACKS}
                onClick={() => {
                  const id = crypto.randomUUID();
                  updateSong((s) => ({
                    ...s,
                    tracks: [
                      ...s.tracks,
                      {
                        ...detail,
                        id,
                        name: `${detail.name} copy`,
                        generated: false,
                      },
                    ],
                    sections: s.sections?.map((section) => ({
                      ...section,
                      trackIds: section.trackIds.includes(detail.id)
                        ? [...section.trackIds, id]
                        : section.trackIds,
                    })),
                  }));
                  setDetailId(id);
                }}
              >
                <Copy size={18} /> Make a copy
              </button>

              <button
                className="button full"
                onClick={() => play([detail], detail.id)}
                disabled={detail.muted || loading}
              >
                {playing === detail.id ? (
                  <Square size={18} />
                ) : (
                  <Play size={18} />
                )}{' '}
                {playing === detail.id ? 'Stop' : 'Listen to this part'}
              </button>
              <button
                className="button full"
                aria-pressed={detail.smoother}
                onClick={() =>
                  patchTrack(detail.id, (t) => smoothTrack(t, song!.context!))
                }
              >
                <Sparkles size={18} />
                {detail.smoother ? 'Undo smoothing' : 'Make smoother'}
              </button>
              <button
                className="button full"
                onClick={() => openRecorder(detail.instrument, detail.id)}
              >
                <Mic size={18} /> Record again
              </button>
              {detail.original && (
                <button
                  className="button full"
                  onClick={() =>
                    download(
                      detail.original!,
                      `${safeFilename(detail.name)}-original.wav`,
                    )
                  }
                >
                  <Download size={18} /> Save original recording
                </button>
              )}
              <button
                className="button full danger"
                onClick={() => {
                  stop();

                  updateSong((s) => ({
                    ...s,
                    tracks: s.tracks.filter((t) => t.id !== detail.id),
                    sections: s.sections?.map((section) => ({
                      ...section,
                      trackIds: section.trackIds.filter(
                        (id) => id !== detail.id,
                      ),
                    })),
                  }));
                  setDetailId(null);
                }}
              >
                <Trash2 size={18} /> Remove part
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={credits} onOpenChange={setCredits}>
        <DialogContent className="app-dialog">
          <DialogTitle className="dialog-title">
            A good sound. A private space.
          </DialogTitle>
          <DialogDescription>
            TapComposer listens only when you ask it to.
          </DialogDescription>
          <div className="credits-text">
            <p>
              Recording, melody detection, playback, and export happen in your
              browser. Your songs and original recordings are stored here, on
              your device. Premium rendering sends the arranged audio and style
              direction to our inference service when you choose “Make a studio
              take.” Original microphone recordings stay here. Clearing your
              browser’s data removes them. Download anything you want to keep.
            </p>
            <p>
              Humming recognition uses{' '}
              <a
                href="https://github.com/marl/crepe"
                target="_blank"
                rel="noreferrer"
              >
                CREPE
              </a>{' '}
              by Jong Wook Kim and collaborators, via torchcrepe and onnxcrepe
              (MIT). It runs here on your device, with a quick detector as
              backup.
            </p>
            <p>
              Piano: Salamander Grand Piano by Alexander Holm, shared under{' '}
              <a
                href="https://creativecommons.org/licenses/by/3.0/"
                target="_blank"
                rel="noreferrer"
              >
                CC BY 3.0
              </a>
              . Samples distributed by{' '}
              <a
                href="https://github.com/Tonejs/audio/tree/master/salamander"
                target="_blank"
                rel="noreferrer"
              >
                Tone.js
              </a>
              , played at adjusted pitches with a little room ambience.
            </p>
            <p>
              Drums and synth are generated locally. Bass, guitar, and violin
              samples are curated by{' '}
              <a
                href="https://github.com/nbrosowsky/tonejs-instruments"
                target="_blank"
                rel="noreferrer"
              >
                Nathan Brosowsky
              </a>{' '}
              from Karoryfer, University of Iowa, and VSCO sources (CC BY 3.0).
              These samples are trimmed and compressed, with pitch adjustment
              and room ambience. MP3 encoding uses{' '}
              <a
                href="https://github.com/shijinyu/lamejs"
                target="_blank"
                rel="noreferrer"
              >
                lamejs
              </a>{' '}
              (LGPL-3.0).
            </p>
            <p className="headphone-note">
              <Headphones size={18} /> Headphones help when recording over your
              song.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
