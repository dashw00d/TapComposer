'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AudioLines,
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
  RotateCcw,
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
import { Switch } from '@/components/ui/switch';
import { AudioEngine } from '@/lib/music/audio';
import { microphoneError } from '@/lib/music/capture';
import { buildIntent } from '@/lib/music/analyze';
import {
  inferContext,
  resolveIntent,
  smoothTrack,
  songDuration,
} from '@/lib/music/resolve';
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
  const [song, setSong] = useState<Song | null>(null);
  const [saveState, setSaveState] = useState('Opening your songs…');
  const [error, setError] = useState('');
  const [recorder, setRecorder] = useState<{
    instrument: Instrument;
    replaceId?: string;
  } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [library, setLibrary] = useState<Song[] | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<{
    track: Track;
    index: number;
  } | null>(null);
  const [credits, setCredits] = useState(false);
  const [audioEngine] = useState(() => new AudioEngine());
  const playback = useRef<{ startAt: number; duration: number } | null>(null);
  const saves = useRef<Promise<void>>(Promise.resolve());
  const currentSongId = useRef('');
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
        if (mounted.current) setSong(songs[0] ?? newSong());
      })
      .catch(() => {
        if (mounted.current) {
          setSong(newSong());
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
  }, [audioEngine]);
  useEffect(() => {
    if (!song) return;
    currentSongId.current = song.id;
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
    setSong((s) => (s ? { ...change(s), updatedAt: Date.now() } : s));
  }
  function stop() {
    playSerial.current++;
    audioEngine.stop();
    setPlaying(null);
    setLoading(false);
    playback.current = null;
    setProgress(0);
  }
  async function play(tracks: Track[], id: string) {
    if (playing === id) {
      stop();
      return;
    }
    stop();
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
      );
      if (token !== playSerial.current || !mounted.current) return;
      playback.current = p;
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
        'This song has 12 parts. Remove one or start a new song to add more.',
      );
      return;
    }
    stop();
    setDetailId(null);
    setRecorder({ instrument, replaceId });
  }
  function keep(track: Track, context: NonNullable<Song['context']>) {
    updateSong((s) => ({
      ...s,
      context,
      tracks: s.tracks.some((t) => t.id === track.id)
        ? s.tracks.map((t) => (t.id === track.id ? track : t))
        : [...s.tracks, track],
    }));
    setRecorder(null);
    setDeleted(null);
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
      if (format === 'wav') blob = await getEngine().exportWav(song.tracks);
      else {
        const buffer = await getEngine().render(song.tracks);
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
  function demo() {
    if (!song || song.tracks.length) return;
    const intent = buildIntent(
      'hum',
      [60, 64, 67, 64, 62, 60].map((pitch, i) => ({
        pitch,
        time: i * 0.48,
        duration: i === 5 ? 0.85 : 0.36,
        confidence: 1,
        intensity: i === 0 ? 0.85 : 0.65,
      })),
      4.8,
    );
    const context = inferContext(intent);
    const piano: Track = {
      id: crypto.randomUUID(),
      instrument: 'piano',
      name: 'Piano example',
      intent,
      ...resolveIntent(intent, 'piano', context),
      original: null,
      muted: false,
      smoother: false,
    };
    const taps = buildIntent(
      'touch',
      Array.from({ length: 8 }, (_, i) => ({
        pitch: null,
        time: i * 0.48,
        duration: 0.1,
        confidence: 1,
        intensity: i % 2 === 0 ? 0.9 : 0.6,
      })),
      4.8,
    );
    const drums: Track = {
      id: crypto.randomUUID(),
      instrument: 'drums',
      name: 'Drums example',
      intent: taps,
      ...resolveIntent(taps, 'drums', context),
      original: null,
      muted: false,
      smoother: false,
    };
    updateSong((s) => ({ ...s, context, tracks: [piano, drums] }));
    void play([piano, drums], 'all');
  }
  const tracks = song?.tracks ?? [],
    duration = songDuration(tracks),
    detail = tracks.find((t) => t.id === detailId);
  const canPlay = tracks.some((t) => !t.muted);
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <AudioLines /> TapComposer<span className="edition">EARLY PLAY</span>
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
      <main className="workspace">
        <div className="intro">
          <div>
            <p className="eyebrow">A LITTLE MUSIC, ALL YOURS</p>
            <h1>Make something.</h1>
            <p>Hum a melody. Tap a rhythm. See where it goes.</p>
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
        <section className="instrument-grid" aria-label="Choose an instrument">
          <button
            className="instrument-card piano"
            disabled={!song}
            onClick={() => openRecorder('piano')}
          >
            <div className="instrument-top">
              <Piano />
              <ArrowUpRight />
            </div>
            <h2>Piano</h2>
            <p>Turn a hum into a melody.</p>
            <span className="card-action">
              Hum something <Plus size={18} />
            </span>
          </button>
          <button
            className="instrument-card drums"
            disabled={!song}
            onClick={() => openRecorder('drums')}
          >
            <div className="instrument-top">
              <Drum />
              <ArrowUpRight />
            </div>
            <h2>Drums</h2>
            <p>There’s a beat in your fingertips.</p>
            <span className="card-action">
              Tap something <Plus size={18} />
            </span>
          </button>
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
              onClick={() => play(tracks, 'all')}
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
                  : 'Play everything'}
            </button>
          </div>
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
              <div className="track-list">
                {tracks.map((track) => (
                  <div
                    key={track.id}
                    className={`track-row ${track.muted ? 'muted' : ''}`}
                  >
                    <button
                      className={`track-icon ${track.instrument}`}
                      aria-label={`Listen to ${track.name}`}
                      disabled={track.muted || loading}
                      onClick={() => play([track], track.id)}
                    >
                      {playing === track.id ? (
                        <Square size={20} />
                      ) : track.instrument === 'piano' ? (
                        <Piano size={24} />
                      ) : (
                        <Drum size={24} />
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
                        {track.intent.source === 'hum'
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
                              left: `${(e.time / duration) * 96}%`,
                              width: `${Math.max(0.8, (e.duration / duration) * 96)}%`,
                              height:
                                track.instrument === 'piano'
                                  ? '7px'
                                  : `${12 + e.velocity * 22}px`,
                              top:
                                track.instrument === 'piano'
                                  ? `${12 + ((84 - e.note) / 48) * 65}%`
                                  : '25%',
                              background:
                                track.instrument === 'piano'
                                  ? '#c7bdf5'
                                  : '#f2c276',
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
          {deleted && (
            <output className="undo-bar">
              <span>{deleted.track.name} removed.</span>
              <button
                onClick={() => {
                  updateSong((s) => {
                    const next = [...s.tracks];
                    next.splice(deleted.index, 0, deleted.track);
                    return { ...s, tracks: next };
                  });
                  setDeleted(null);
                }}
              >
                <RotateCcw size={15} /> Undo
              </button>
            </output>
          )}
        </section>
        <footer>
          <span>Made by you. A little help from TapComposer.</span>
          <button className="footer-link" onClick={() => setCredits(true)}>
            Sound credits & privacy
          </button>
        </footer>
      </main>
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
              setSong(newSong());
              setDeleted(null);
              setLibrary(null);
            }}
          >
            <Plus size={18} /> New song
          </button>
          <div className="saved-songs">
            {library?.map((s) => (
              <button
                key={s.id}
                className="saved-song"
                onClick={() => {
                  stop();
                  setSong(s);
                  setDeleted(null);
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
                  setDeleted({ track: detail, index: tracks.indexOf(detail) });
                  updateSong((s) => ({
                    ...s,
                    tracks: s.tracks.filter((t) => t.id !== detail.id),
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
              browser. Your songs and original recordings are stored here,
              without being sent to a server. Clearing your browser’s data
              removes them. Download anything you want to keep.
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
              Drum sounds are synthesized in TapComposer. MP3 encoding uses{' '}
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
