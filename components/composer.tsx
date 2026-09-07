'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import Link from 'next/link';
import {
  GitBranch,
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
  Piano,
  Play,
  Plus,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { AudioComparison, type ComparisonSource } from './audio-comparison';
import { pauseOtherAudio } from '@/lib/music/media';
import {
  directPart,
  setPartProtection,
  DIRECTIONS,
  forkDirection,
  originLabel,
} from '@/lib/music/direct';
import { CompositionPanel, MixControls } from './composition-panel';
import { useSongHistory } from '@/hooks/use-song-history';
import { INSTRUMENTS } from '@/lib/music/instruments';
import { arrangedTracks, keepIdea } from '@/lib/music/composition';
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
import { SongTimeline } from './song-timeline';

export default function Composer() {
  const history = useSongHistory();
  const { song, load: loadSong } = history;
  const [mixOpen, setMixOpen] = useState(false);
  const [proposal, setProposal] = useState<{
    label: string;
    before: Song;
    after: Song;
    sources: ComparisonSource[];
    retry?: (song: Song) => Song;
    serial: number;
  } | null>(null);
  const proposalSerial = useRef(0);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchName, setBranchName] = useState('');

  const [seekAt, setSeekAt] = useState(0);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const projectInput = useRef<HTMLInputElement | null>(null);
  const [saveState, setSaveState] = useState('Opening your songs…');
  const [error, setError] = useState('');
  const [recorder, setRecorder] = useState<{
    instrument: Instrument;
    captureFirst?: boolean;
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
      const prepared = arrangedTracks(next);
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
    pauseOtherAudio();
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
  function openRecorder(
    instrument: Instrument,
    replaceId?: string,
    captureFirst = false,
  ) {
    if (!song) return;
    if (!replaceId && song.tracks.length >= MAX_TRACKS) {
      setError(
        'This song has 24 parts. Remove one or start a new song to add more.',
      );
      return;
    }
    stop();
    setDetailId(null);
    setRecorder({ instrument, replaceId, captureFirst });
    pauseOtherAudio();
  }
  function propose(label: string, after: Song, retry?: (song: Song) => Song) {
    if (!song) return;
    stop();
    pauseOtherAudio();
    setDetailId(null);
    setProposal({
      label,
      before: song,
      after,
      retry,
      serial: ++proposalSerial.current,
      sources: [
        { id: 'before', label: 'Before', song },
        { id: 'after', label: 'Proposed', song: after },
      ],
    });
  }
  const branching = useRef(false);
  async function branch() {
    if (!song || branching.current) return;
    branching.current = true;
    try {
      await saves.current;
      const current = latestSong.current;
      if (!current || current.id !== song.id) return;
      const next = forkDirection(current, branchName);
      await saveSong(next);
      stop();
      if (currentSongId.current === song.id) loadSong(next);
      setBranchOpen(false);
    } catch {
      setError(
        'Could not save this direction. Your current song is still open.',
      );
    } finally {
      branching.current = false;
    }
  }
  function keepLayers(tracks: Track[], context: NonNullable<Song['context']>) {
    updateSong((s) =>
      tracks.reduce((next, track) => keepIdea(next, track, context), s),
    );
    setRecorder(null);
  }
  function keep(track: Track, context: NonNullable<Song['context']>) {
    updateSong((s) => keepIdea(s, track, context));
    setRecorder(null);
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
  const transportTracks = song ? arrangedTracks(song) : [];
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
      <main
        className={`workspace studio-workspace ${tracks.length ? 'has-song' : ''}`}
      >
        {!tracks.length && (
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
        )}
        {error && (
          <div className="error-box page-error" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss message" onClick={() => setError('')}>
              <X size={18} />
            </button>
          </div>
        )}
        <div className="capture-first">
          <div>
            <strong>
              {tracks.length ? 'Add to your song' : 'Catch an idea.'}
            </strong>
            <span>Choose its instruments after you hear it.</span>
          </div>
          <button
            className="button primary"
            disabled={!song}
            onClick={() => openRecorder('piano', undefined, true)}
          >
            <Mic size={18} /> Hum an idea
          </button>
          <button
            className="button"
            disabled={!song}
            onClick={() => openRecorder('drums', undefined, true)}
          >
            <Drum size={18} /> Tap a rhythm
          </button>
        </div>
        <details className="instrument-drawer">
          <summary>Or start with an instrument</summary>
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
        </details>
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
                  : 'Play my song'}
            </button>
          </div>
          <div className="studio-toolbar">
            <span className="workspace-label">Song workspace</span>
            <div className="history-actions">
              <button
                className="icon-button"
                aria-label="Save another direction"
                title="Save another direction"
                disabled={!song?.tracks.length}
                onClick={() => {
                  stop();
                  setBranchName(
                    `${song?.name ?? 'My song'} · another direction`.slice(
                      0,
                      60,
                    ),
                  );
                  setBranchOpen(true);
                }}
              >
                <GitBranch size={19} />
              </button>
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
                aria-expanded={mixOpen}
                onClick={() => setMixOpen((open) => !open)}
              >
                <SlidersHorizontal size={17} /> Volume & balance
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
          {song && mixOpen && <MixControls song={song} update={updateMusic} />}
          {tracks.length === 0 ? (
            <div className="empty-song">
              <AudioLines size={38} />
              <h3>A little quiet in here.</h3>
              <p>Hum an idea or tap a rhythm. Your song starts with you.</p>
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
              {song && (
                <SongTimeline
                  key={song.id}
                  song={song}
                  update={updateSong}
                  onPlay={(track) =>
                    void play([{ ...track, muted: false }], track.id)
                  }
                  onAudition={(track, index) => {
                    const e = track.events[index];
                    if (e)
                      void play(
                        [
                          {
                            ...track,
                            muted: false,
                            events: [{ ...e, time: 0 }],
                            duration: e.duration,
                          },
                        ],
                        track.id,
                        0,
                        true,
                      );
                  }}
                  playing={playing}
                  position={playing === 'all' ? position : seekAt}
                  onSeek={(seconds) =>
                    void play(arrangedTracks(song), 'all', seconds, true)
                  }
                  onMore={setDetailId}
                  onUndo={() => {
                    stop();
                    history.undo();
                  }}
                  canUndo={history.canUndo}
                />
              )}
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
          {song && tracks.length > 0 && (
            <CompositionPanel
              showSections={false}
              song={song}
              update={updateMusic}
              onSeek={(seconds) =>
                void play(arrangedTracks(song), 'all', seconds, true)
              }
              position={position}
              onPropose={propose}
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
          onKeepLayers={keepLayers}
        />
      )}
      <Dialog
        open={!!proposal}
        onOpenChange={(open) => {
          if (!open) setProposal(null);
        }}
      >
        <DialogContent className="app-dialog comparison-dialog">
          <DialogTitle>{proposal?.label}</DialogTitle>
          <DialogDescription>
            Listen in context. Your song changes only when you keep the
            proposal.
          </DialogDescription>
          {proposal && (
            <>
              <AudioComparison
                key={proposal.serial}
                sources={proposal.sources}
                engine={audioEngine}
                onBeforePlay={stop}
              />
              <div className="review-actions">
                <button className="button" onClick={() => setProposal(null)}>
                  Go back
                </button>
                {proposal.retry && (
                  <button
                    className="button"
                    onClick={() => {
                      const after = proposal.retry!(proposal.after);
                      setProposal({
                        ...proposal,
                        after,
                        serial: proposal.serial + 1,
                        sources: [
                          proposal.sources[0],
                          { id: 'after', label: 'Proposed', song: after },
                        ],
                      });
                    }}
                  >
                    Try another
                  </button>
                )}
                <button
                  className="button primary"
                  onClick={() => {
                    updateSong((s) =>
                      s.id === proposal.before.id
                        ? { ...proposal.after, premiumTakes: s.premiumTakes }
                        : s,
                    );
                    setProposal(null);
                  }}
                >
                  Keep this change
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={branchOpen} onOpenChange={setBranchOpen}>
        <DialogContent className="app-dialog">
          <DialogTitle>Another direction, same song.</DialogTitle>
          <DialogDescription>
            Save a separate editable version. Your current direction stays in
            your library, with its recordings and studio takes.
          </DialogDescription>
          <label htmlFor="branch-name">Name this direction</label>
          <input
            id="branch-name"
            className="part-name-input"
            maxLength={60}
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
          />
          <button className="button primary" onClick={() => void branch()}>
            Save and explore this direction
          </button>
        </DialogContent>
      </Dialog>
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
                    {s.branchedFrom ? 'Alternate direction · ' : ''}
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
              <p className="part-provenance">
                {originLabel(detail)}.{' '}
                {detail.pinned
                  ? 'Kept during automatic changes.'
                  : detail.generated
                    ? 'Composed from your song’s rhythm and harmony.'
                    : 'Your original idea stays available.'}
              </p>
              <p className="control-help">
                Change the sound and notes in the editor below the song. These
                extra options shape or manage the whole part.
              </p>
              <details className="gentle-details" open={detail.generated}>
                <summary>Change what it plays</summary>
                <div className="direction-buttons">
                  {DIRECTIONS.map((direction) => (
                    <button
                      key={direction.id}
                      className="button"
                      disabled={
                        (direction.id === 'later' &&
                          !song?.sections?.length &&
                          !song?.clips?.length) ||
                        (direction.id === 'answer' &&
                          !song?.tracks.some(
                            (t) =>
                              t.id !== detail.id &&
                              !t.generated &&
                              t.intent.events.some((e) => e.pitch !== null),
                          ))
                      }
                      onClick={() => {
                        if (song)
                          propose(
                            direction.label,
                            directPart(song, detail.id, direction.id, true),
                          );
                      }}
                    >
                      {direction.label}
                    </button>
                  ))}
                </div>
                <p className="control-help">
                  Hear a preview before keeping a change. You can always Undo.
                </p>
              </details>
              <details className="gentle-details">
                <summary>Sound &amp; other options</summary>
                <label className="keep-part-option">
                  <Switch
                    checked={
                      !!detail.pinned ||
                      !!song?.sections?.some(
                        (s) => s.pinned && s.trackIds.includes(detail.id),
                      )
                    }
                    onCheckedChange={(pinned) =>
                      updateSong((s) => setPartProtection(s, detail.id, pinned))
                    }
                  />{' '}
                  Protect my edits when rearranging
                </label>
                <label className="field-label" htmlFor="part-name">
                  Name this part
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
                          pinned: true,
                          edited: true,
                        },
                      ],
                      clips: s.clips
                        ? [
                            ...s.clips,
                            ...s.clips
                              .filter((c) => c.trackId === detail.id)
                              .map((c) => ({
                                ...c,
                                id: crypto.randomUUID(),
                                trackId: id,
                              })),
                          ].slice(0, 576)
                        : undefined,
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
                  <Copy size={18} /> Copy this part and its blocks
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
                  disabled={detail.edited}
                  title={
                    detail.edited
                      ? 'Use the note controls to tidy this edited part'
                      : 'Gently tighten the original timing'
                  }
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
                      clips: s.clips?.filter((c) => c.trackId !== detail.id),
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
              </details>
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
              direction to the GPU service on this computer when you choose
              “Make a studio take.” Original microphone recordings stay here.
              Clearing your browser’s data removes them. Download anything you
              want to keep.
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
