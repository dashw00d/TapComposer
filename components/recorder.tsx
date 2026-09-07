'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Drum,
  Hand,
  Headphones,
  Mic,
  Music2,
  Piano,
  Play,
  RotateCcw,
  Sparkles,
  Square,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { AudioEngine } from '@/lib/music/audio';
import {
  beginCapture,
  alignCapturedIntent,
  microphoneError,
  understandRecording,
  type CaptureSession,
} from '@/lib/music/capture';
import { buildIntent } from '@/lib/music/analyze';
import { prepareUnderstanding } from '@/lib/music/analysis-client';
import { inferContext, resolveIntent, smoothTrack } from '@/lib/music/resolve';
import type {
  Instrument,
  IntentEvent,
  MusicalIntent,
  Song,
  Track,
} from '@/lib/music/types';
import { layerIdea } from '@/lib/music/direct';
import { Switch } from '@/components/ui/switch';
import { patternTracks, changeInstrument } from '@/lib/music/composition';
import { INSTRUMENTS, instrumentInfo } from '@/lib/music/instruments';
import { MAX_SECONDS } from '@/lib/music/types';

interface Props {
  instrument: Instrument;
  captureFirst?: boolean;
  onKeepLayers?: (
    tracks: Track[],
    context: NonNullable<Song['context']>,
  ) => void;
  song: Song;
  engine: AudioEngine;
  replaceId?: string;
  onClose: () => void;
  onKeep: (track: Track, context: NonNullable<Song['context']>) => void;
}
export function Recorder({
  instrument: initialInstrument,
  captureFirst = false,
  onKeepLayers,
  song,
  engine,
  replaceId,
  onClose,
  onKeep,
}: Props) {
  const [instrument, setInstrument] = useState(initialInstrument);
  const [chosen, setChosen] = useState<Instrument[]>([initialInstrument]);
  const [layering, setLayering] = useState(false);
  const [inContext, setInContext] = useState(false);
  const [phase, setPhase] = useState<
    'ready' | 'requesting' | 'countdown' | 'recording' | 'analyzing' | 'review'
  >('ready');
  const [mode, setMode] = useState<'touch' | 'mic' | 'hum'>(
    instrument === 'drums' ? 'touch' : 'hum',
  );
  const [countdown, setCountdown] = useState(3);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [count, setCount] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [draft, setDraft] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const session = useRef<CaptureSession | null>(null);
  const active = useRef(true),
    serial = useRef(0),
    phaseRef = useRef(phase);
  const tapEvents = useRef<IntentEvent[]>([]),
    tapStart = useRef(0),
    interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const analysisCancel = useRef<(() => void) | null>(null);
  const context = useRef(song.context);
  const backing = patternTracks({
    ...song,
    tracks: song.tracks.filter((t) => t.id !== replaceId),
  });
  const label = instrumentInfo(instrument).name;
  useEffect(() => {
    if (mode === 'hum') prepareUnderstanding();
  }, [mode]);
  const transition = (next: typeof phase) => {
    phaseRef.current = next;
    setPhase(next);
  };
  useEffect(() => {
    active.current = true;
    // This is a mutable operation counter, not a React node ref. Cancel whichever operation is current.
    return () => {
      active.current = false;
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      serial.current++;
      session.current?.cancel();
      analysisCancel.current?.();
      engine.stop();
      if (interval.current) clearInterval(interval.current);
    };
  }, [engine]);

  async function preview(
    track: Track,
    instruments = chosen,
    together = inContext,
  ) {
    try {
      setPlaying(true);
      const layers = context.current
        ? layerIdea(song, track, instruments, context.current)
        : [track];
      const tracks = together
        ? patternTracks({
            ...song,
            context: context.current,
            tracks: [
              ...song.tracks.filter((t) => t.id !== replaceId),
              ...layers,
            ],
          })
        : layers;
      await engine.play(tracks, false, () => {
        if (active.current) setPlaying(false);
      });
    } catch (e) {
      if (active.current) {
        setPlaying(false);
        setError(microphoneError(e));
      }
    }
  }
  function makeDraft(intent: MusicalIntent, original: Blob | null) {
    if (!intent.events.length) {
      transition('ready');
      setError(
        intent.source === 'hum'
          ? 'I couldn’t pick out the notes in that take. Try again a little closer to the microphone.'
          : 'I couldn’t hear distinct taps. Try a few firmer taps with little gaps between them.',
      );
      return;
    }
    const normalized = alignCapturedIntent(intent, backing.length > 0);
    const hasMelody = song.tracks.some(
      (t) => !t.generated && t.intent.events.some((e) => e.pitch !== null),
    );
    const inferred = inferContext(normalized);
    context.current = song.context
      ? !hasMelody && normalized.source === 'hum'
        ? { ...inferred, tempo: song.context.tempo }
        : song.context
      : inferred;
    const arrangement = resolveIntent(
      normalized,
      instrument,
      context.current,
      false,
      true,
    );
    const previous = song.tracks.find((t) => t.id === replaceId);
    const track: Track = {
      id: replaceId ?? crypto.randomUUID(),
      instrument,
      name:
        previous?.name ??
        `${label} ${song.tracks.filter((t) => t.instrument === instrument).length + 1}`,
      intent: normalized,
      ...arrangement,
      original,
      muted: false,
      smoother: false,
      sourceTempo: context.current.tempo,
    };
    setDraft(track);
    transition('review');
    void preview(track);
  }
  async function finishMic(pcm: Float32Array, rate: number) {
    if (!active.current) return;
    session.current = null;
    engine.stop();
    setLevel(0);
    transition('analyzing');
    setAnalysisProgress(0);
    const token = serial.current;
    try {
      const task = understandRecording(
        pcm,
        rate,
        mode === 'hum' ? 'hum' : 'microphone-taps',
        (progress) => {
          if (active.current) setAnalysisProgress(progress);
        },
      );
      analysisCancel.current = task.cancel;
      const intent = await task.result;
      analysisCancel.current = null;
      if (active.current && token === serial.current)
        makeDraft(intent, task.original);
    } catch (e) {
      if (active.current && token === serial.current) {
        setError(microphoneError(e));
        transition('ready');
      }
    }
  }
  function cancelCountIn() {
    serial.current++;
    session.current?.cancel();
    session.current = null;
    if (interval.current) clearInterval(interval.current);
    interval.current = null;
    engine.stop();
    setLevel(0);
    setElapsed(0);
    transition('ready');
  }
  async function startMic() {
    if (phaseRef.current !== 'ready') return;
    setError('');
    setElapsed(0);
    setCountdown(3);
    transition('requesting');
    engine.stop();
    const token = ++serial.current;
    try {
      await engine.load([
        instrument,
        ...backing.filter((t) => !t.muted).map((t) => t.instrument),
      ]);
      if (!active.current || token !== serial.current) return;
      const capture = await beginCapture(
        engine,
        (volume, time) => {
          if (active.current && token === serial.current) {
            setLevel(volume);
            setElapsed(time);
          }
        },
        (pcm, rate) => {
          if (active.current && token === serial.current) {
            if (interval.current) clearInterval(interval.current);
            interval.current = null;
            void finishMic(pcm, rate);
          }
        },
      );
      if (!active.current || token !== serial.current) {
        capture.cancel();
        return;
      }
      session.current = capture;
      transition('countdown');
      const tick = () => {
        if (!active.current || token !== serial.current) return;
        const remaining = capture.startAt - capture.currentTime();
        setCountdown(Math.max(0, Math.min(3, Math.ceil(remaining))));
        if (remaining <= 0) {
          transition('recording');
          if (interval.current) clearInterval(interval.current);
          interval.current = null;
        }
      };
      tick();
      interval.current = setInterval(tick, 16);
      if (backing.some((t) => !t.muted))
        await engine.play(backing, true, () => {}, capture.startAt);
      if (!active.current || token !== serial.current) return;
      if (capture.currentTime() >= capture.startAt) {
        cancelCountIn();
        setError(
          'Getting the audio ready took longer than expected. Start again for a fresh countdown.',
        );
      }
    } catch (e) {
      if (active.current && token === serial.current) {
        cancelCountIn();
        setError(microphoneError(e));
      }
    }
  }
  function stopMic() {
    if (phaseRef.current === 'recording') {
      transition('analyzing');
      session.current?.stop();
    }
  }
  function finishTaps() {
    if (interval.current) clearInterval(interval.current);
    interval.current = null;
    engine.stop();
    makeDraft(
      buildIntent(
        'touch',
        [...tapEvents.current],
        // Called only when the recording finishes, never during rendering.
        // oxlint-disable-next-line react/react-compiler
        Math.min(MAX_SECONDS, (performance.now() - tapStart.current) / 1000),
      ),
      null,
    );
  }
  async function tap() {
    if (!['ready', 'recording'].includes(phaseRef.current)) return;
    if (phaseRef.current === 'ready') {
      transition('requesting');
      setError('');
      try {
        await engine.load([
          instrument,
          ...backing.filter((t) => !t.muted).map((t) => t.instrument),
        ]);
        await engine.ready();
        if (!active.current) return;
        // Event-time capture after the audio device is ready.
        // oxlint-disable-next-line react/react-compiler
        tapStart.current = performance.now();
        tapEvents.current = [];
        transition('recording');
        if (backing.some((t) => !t.muted))
          await engine.play(backing, true, () => {});
        // The first tap defines zero; the audio's tiny scheduling lead is immaterial for human taps.
        interval.current = setInterval(() => {
          // Recording event time, never evaluated during rendering.
          // oxlint-disable-next-line react/react-compiler
          const time = (performance.now() - tapStart.current) / 1000;
          setElapsed(time);
          if (time >= MAX_SECONDS) finishTaps();
        }, 50);
      } catch (e) {
        if (active.current) {
          setError(microphoneError(e));
          transition('ready');
        }
        return;
      }
    }
    // Recording event time, never evaluated during rendering.
    // oxlint-disable-next-line react/react-compiler
    const time = (performance.now() - tapStart.current) / 1000;
    const last = tapEvents.current.at(-1);
    if (last && time - last.time < 0.09) return;
    tapEvents.current.push({
      time,
      duration: 0.1,
      pitch: null,
      confidence: 1,
      intensity: tapEvents.current.length % 4 === 0 ? 0.95 : 0.65,
    });
    setCount(tapEvents.current.length);
    setLevel(0.5);
    setTimeout(() => {
      if (active.current) setLevel(0);
    }, 90);
    void engine.tap().catch((e) => {
      if (active.current) setError(microphoneError(e));
    });
  }
  function reset() {
    engine.stop();
    setPlaying(false);
    setDraft(null);
    setCount(0);
    setElapsed(0);
    setError('');
    transition('ready');
    tapEvents.current = [];
  }
  const busy =
    phase === 'requesting' || phase === 'countdown' || phase === 'analyzing';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="record-dialog" showCloseButton>
        <div
          className={`dialog-instrument ${instrument}`}
          style={{ background: instrumentInfo(instrument).color }}
        >
          {instrument === 'piano' ? (
            <Piano />
          ) : instrument === 'drums' ? (
            <Drum />
          ) : (
            <Music2 />
          )}
        </div>
        <DialogTitle className="dialog-title">
          {phase === 'review'
            ? 'Find its voice.'
            : captureFirst
              ? 'Start with your idea.'
              : `${label}, your way.`}
        </DialogTitle>
        <DialogDescription className="dialog-description">
          {phase === 'review'
            ? 'Same idea, different instruments. Choose a sound to hear it.'
            : mode === 'hum'
              ? 'Hum or sing your idea. A “hmm” or “dum dum” is enough.'
              : mode === 'touch'
                ? 'Tap the pad or press Space while it’s selected.'
                : 'Tap a desk near your microphone. Leave a little space between taps.'}
        </DialogDescription>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        {phase !== 'review' ? (
          <>
            {
              <div className="mode-buttons">
                <button
                  className={mode === 'hum' ? 'selected' : ''}
                  disabled={phase !== 'ready'}
                  onClick={() => {
                    setMode('hum');
                    setError('');
                  }}
                >
                  <Mic size={17} /> Hum
                </button>
                <button
                  className={mode === 'touch' ? 'selected' : ''}
                  disabled={phase !== 'ready'}
                  onClick={() => {
                    setMode('touch');
                    setError('');
                  }}
                >
                  <Hand size={17} /> Tap pad
                </button>
                <button
                  className={mode === 'mic' ? 'selected' : ''}
                  disabled={phase !== 'ready'}
                  onClick={() => {
                    setMode('mic');
                    setError('');
                  }}
                >
                  <Hand size={17} /> Desk taps
                </button>
              </div>
            }
            <div
              className={`record-zone ${phase === 'recording' ? 'is-recording' : ''}`}
            >
              <div className="level-meter" aria-hidden="true">
                {Array.from({ length: 27 }, (_, i) => (
                  <i
                    key={i}
                    style={{
                      height: `${8 + Math.min(1, level * 10) * (12 + Math.sin(i * 2.7) ** 2 * 40)}px`,
                    }}
                  />
                ))}
              </div>
              {mode === 'touch' ? (
                <button
                  className="tap-pad"
                  aria-label="Tap rhythm pad"
                  disabled={busy}
                  onPointerDown={(e) => {
                    if (e.button === 0) {
                      e.preventDefault();
                      e.currentTarget.focus();
                      void tap();
                    }
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                      e.preventDefault();
                      void tap();
                    }
                  }}
                  onClick={(e) => {
                    if (e.detail === 0) void tap();
                  }}
                >
                  <Drum size={38} />
                  <span>
                    {busy
                      ? 'Getting ready…'
                      : phase === 'recording'
                        ? `${count} ${count === 1 ? 'tap' : 'taps'}`
                        : 'Tap here'}
                  </span>
                </button>
              ) : (
                <>
                  <output
                    className={`capture-cue ${phase === 'recording' ? 'live' : phase === 'countdown' ? 'counting' : ''}`}
                    aria-label="Recording cue"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {phase === 'countdown'
                      ? countdown
                      : phase === 'recording'
                        ? elapsed < 0.8
                          ? mode === 'hum'
                            ? 'Start · hum now'
                            : 'Start · tap now'
                          : 'Recording'
                        : phase === 'requesting'
                          ? 'Getting your microphone ready…'
                          : phase === 'analyzing'
                            ? 'Take captured'
                            : 'Ready when you are'}
                  </output>
                  <button
                    className="record-button"
                    disabled={phase === 'analyzing'}
                    onClick={() => {
                      if (phaseRef.current === 'recording') stopMic();
                      else if (
                        phaseRef.current === 'countdown' ||
                        phaseRef.current === 'requesting'
                      )
                        cancelCountIn();
                      else void startMic();
                    }}
                  >
                    {phase === 'recording' ? (
                      <Square size={26} />
                    ) : (
                      <Mic size={26} />
                    )}
                    {phase === 'recording'
                      ? 'Stop recording'
                      : phase === 'countdown'
                        ? 'Cancel countdown'
                        : phase === 'requesting'
                          ? 'Cancel'
                          : phase === 'analyzing'
                            ? 'Finding your music…'
                            : 'Start recording'}
                  </button>
                </>
              )}
              <p className="record-time">
                {phase === 'recording'
                  ? `${Math.min(30, elapsed).toFixed(1)} / 30 seconds`
                  : phase === 'analyzing'
                    ? analysisProgress > 0
                      ? `Finding your notes… ${Math.round(analysisProgress * 100)}%`
                      : 'Turning your idea into a part…'
                    : mode !== 'touch'
                      ? phase === 'countdown'
                        ? 'Get ready. Recording begins on Start.'
                        : '3–2–1, then start. Click Stop when you’re done.'
                      : 'Up to 30 seconds. Keep it simple.'}
              </p>
            </div>
            {mode === 'touch' && phase === 'recording' && (
              <button className="button primary full" onClick={finishTaps}>
                <Check size={18} /> Hear my idea
              </button>
            )}
            {backing.length > 0 && (
              <p className="headphone-note">
                <Headphones size={17} /> Your song plays along. Headphones work
                best.
              </p>
            )}
            <p className="privacy-note">
              Your microphone recording stays in this browser.
            </p>
          </>
        ) : (
          draft && (
            <>
              <div
                className="sound-auditions"
                aria-label="Audition instruments"
              >
                {INSTRUMENTS.map((info) => (
                  <button
                    key={info.id}
                    className="button"
                    aria-pressed={chosen.includes(info.id)}
                    disabled={
                      layering &&
                      !chosen.includes(info.id) &&
                      chosen.length >=
                        24 - song.tracks.filter((t) => t.id !== draft.id).length
                    }
                    onClick={() => {
                      const next = layering
                        ? chosen.includes(info.id)
                          ? chosen.length > 1
                            ? chosen.filter((id) => id !== info.id)
                            : chosen
                          : [...chosen, info.id]
                        : [info.id];
                      const track = changeInstrument(
                        draft,
                        next[0],
                        context.current!,
                      );
                      setChosen(next);
                      setInstrument(next[0]);
                      setDraft(track);
                      void preview(track, next);
                    }}
                  >
                    {info.name}
                  </button>
                ))}
              </div>
              <details className="gentle-details">
                <summary>Layer sounds or hear it with the song</summary>
                <label>
                  <Switch
                    checked={layering}
                    onCheckedChange={(value) => {
                      setLayering(value);
                      if (!value) {
                        setChosen([instrument]);
                        void preview(draft, [instrument]);
                      }
                    }}
                  />{' '}
                  Use more than one instrument
                </label>
                {!!backing.length && (
                  <label>
                    <Switch
                      checked={inContext}
                      onCheckedChange={(value) => {
                        setInContext(value);
                        void preview(draft, chosen, value);
                      }}
                    />{' '}
                    Hear it with my song
                  </label>
                )}
                <p>The same recording is kept with every sound.</p>
              </details>
              <div className="preview-part">
                <div className="mini-notes" aria-hidden="true">
                  {draft.events.slice(0, 40).map((e, i) => (
                    <i
                      key={i}
                      style={{
                        height: `${15 + e.velocity * 38}px`,
                        background: instrumentInfo(instrument).color,
                      }}
                    />
                  ))}
                </div>
                <button
                  className="button full"
                  onClick={() => {
                    if (playing) {
                      engine.stop();
                      setPlaying(false);
                    } else void preview(draft);
                  }}
                >
                  {playing ? <Square size={17} /> : <Play size={17} />}{' '}
                  {playing ? 'Stop listening' : 'Listen again'}
                </button>
              </div>
              <div className="review-actions">
                <button className="button" onClick={reset}>
                  <RotateCcw size={17} /> Try again
                </button>
                <button
                  className="button"
                  aria-pressed={draft.smoother}
                  onClick={() => {
                    const track = smoothTrack(draft, context.current!);
                    setDraft(track);
                    void preview(track);
                  }}
                >
                  <Sparkles size={17} />
                  {draft.smoother ? 'Undo smoothing' : 'Make smoother'}
                </button>
              </div>
              <button
                className="button primary full"
                onClick={() => {
                  engine.stop();
                  if (onKeepLayers)
                    onKeepLayers(
                      layerIdea(song, draft, chosen, context.current!),
                      context.current!,
                    );
                  else onKeep(draft, context.current!);
                }}
              >
                <Check size={19} /> Keep it
              </button>
            </>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
