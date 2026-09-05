'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Drum,
  Hand,
  Headphones,
  Mic,
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
  microphoneError,
  understandRecording,
  type CaptureSession,
} from '@/lib/music/capture';
import { buildIntent } from '@/lib/music/analyze';
import { inferContext, resolveIntent, smoothTrack } from '@/lib/music/resolve';
import type {
  Instrument,
  IntentEvent,
  MusicalIntent,
  Song,
  Track,
} from '@/lib/music/types';
import { MAX_SECONDS } from '@/lib/music/types';

interface Props {
  instrument: Instrument;
  song: Song;
  engine: AudioEngine;
  replaceId?: string;
  onClose: () => void;
  onKeep: (track: Track, context: NonNullable<Song['context']>) => void;
}
export function Recorder({
  instrument,
  song,
  engine,
  replaceId,
  onClose,
  onKeep,
}: Props) {
  const [phase, setPhase] = useState<
    'ready' | 'requesting' | 'recording' | 'analyzing' | 'review'
  >('ready');
  const [mode, setMode] = useState<'touch' | 'mic'>(
    instrument === 'drums' ? 'touch' : 'mic',
  );
  const [micReady, setMicReady] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [count, setCount] = useState(0);
  const [draft, setDraft] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const session = useRef<CaptureSession | null>(null);
  const active = useRef(true),
    serial = useRef(0),
    phaseRef = useRef(phase),
    held = useRef(false);
  const tapEvents = useRef<IntentEvent[]>([]),
    tapStart = useRef(0),
    interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const analysisCancel = useRef<(() => void) | null>(null);
  const context = useRef(song.context);
  const backing = song.tracks.filter((t) => t.id !== replaceId);
  const label = instrument === 'piano' ? 'Piano' : 'Drums';
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

  async function preview(track: Track) {
    try {
      setPlaying(true);
      await engine.play([track], false, () => {
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
        instrument === 'piano'
          ? 'I couldn’t find a clear melody. Try a steady “hmm”, a little closer to the microphone.'
          : 'I couldn’t hear distinct taps. Try a few firmer taps with little gaps between them.',
      );
      return;
    }
    // First part defines the clock. Later parts preserve their offset against it.
    const trim = backing.length === 0 ? intent.events[0].time : 0;
    const normalized = {
      ...intent,
      events: intent.events.map((e) => ({
        ...e,
        time: Math.max(0, e.time - trim),
      })),
      duration: Math.max(0, intent.duration - trim),
    };
    context.current = song.context ?? inferContext(normalized);
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
    const token = serial.current;
    try {
      const task = understandRecording(
        pcm,
        rate,
        instrument === 'piano' ? 'hum' : 'microphone-taps',
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
  async function enableMic() {
    setError('');
    transition('requesting');
    try {
      await engine.prepareCapture();
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          'Open this app on HTTPS or localhost to use the microphone.',
        );
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      if (active.current) {
        setMicReady(true);
        transition('ready');
      }
    } catch (e) {
      if (active.current) {
        setError(microphoneError(e));
        transition('ready');
      }
    }
  }
  async function startMic(isHold = false) {
    if (phaseRef.current !== 'ready') return;
    setError('');
    setElapsed(0);
    transition('requesting');
    engine.stop();
    const token = ++serial.current;
    try {
      if (
        instrument === 'piano' ||
        backing.some((t) => t.instrument === 'piano' && !t.muted)
      )
        await engine.load();
      if (
        !active.current ||
        token !== serial.current ||
        (isHold && !held.current)
      ) {
        if (active.current) transition('ready');
        return;
      }
      const capture = await beginCapture(
        engine,
        (volume, time) => {
          if (active.current) {
            setLevel(volume);
            setElapsed(time);
          }
        },
        finishMic,
      );
      if (
        !active.current ||
        token !== serial.current ||
        (isHold && !held.current)
      ) {
        capture.cancel();
        if (active.current) transition('ready');
        return;
      }
      session.current = capture;
      transition('recording');
      if (backing.some((t) => !t.muted))
        await engine.play(backing, false, () => {}, capture.startAt);
    } catch (e) {
      session.current?.cancel();
      session.current = null;
      if (active.current) {
        setError(microphoneError(e));
        transition('ready');
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
        if (backing.some((t) => t.instrument === 'piano' && !t.muted))
          await engine.load();
        await engine.ready();
        if (!active.current) return;
        tapStart.current = performance.now();
        tapEvents.current = [];
        transition('recording');
        if (backing.some((t) => !t.muted))
          await engine.play(backing, false, () => {});
        // The first tap defines zero; the audio's tiny scheduling lead is immaterial for human taps.
        interval.current = setInterval(() => {
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
  const busy = phase === 'requesting' || phase === 'analyzing';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="record-dialog" showCloseButton>
        <div className={`dialog-instrument ${instrument}`}>
          {instrument === 'piano' ? <Piano /> : <Drum />}
        </div>
        <DialogTitle className="dialog-title">
          {phase === 'review' ? 'Sound like you?' : `${label}, your way.`}
        </DialogTitle>
        <DialogDescription className="dialog-description">
          {phase === 'review'
            ? 'A little idea, turned into music. Give it a listen.'
            : instrument === 'piano'
              ? 'A few notes are enough. Hum them one at a time.'
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
            {instrument === 'drums' && (
              <div className="mode-buttons">
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
                  <Mic size={17} /> Microphone
                </button>
              </div>
            )}
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
                  aria-label="Tap drum pad"
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
              ) : !micReady ? (
                <button
                  className="record-button"
                  disabled={busy}
                  onClick={enableMic}
                >
                  <Mic size={26} />
                  {phase === 'requesting'
                    ? 'Allow the microphone…'
                    : 'Enable microphone'}
                </button>
              ) : (
                <button
                  className="record-button"
                  disabled={phase === 'analyzing'}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    held.current = true;
                    void startMic(true);
                  }}
                  onPointerUp={() => {
                    held.current = false;
                    stopMic();
                  }}
                  onPointerCancel={() => {
                    held.current = false;
                    stopMic();
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                      e.preventDefault();
                      held.current = true;
                      void startMic(true);
                    }
                  }}
                  onKeyUp={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      held.current = false;
                      stopMic();
                    }
                  }}
                  onBlur={() => {
                    held.current = false;
                    stopMic();
                  }}
                >
                  <Mic size={26} />
                  {phase === 'analyzing'
                    ? 'Finding your music…'
                    : phase === 'requesting'
                      ? 'Getting ready…'
                      : phase === 'recording'
                        ? 'Listening… release to hear'
                        : instrument === 'piano'
                          ? 'Hold and hum'
                          : 'Hold and tap'}
                </button>
              )}
              <p className="record-time">
                {phase === 'recording'
                  ? `${Math.min(30, elapsed).toFixed(1)} / 30 seconds`
                  : phase === 'analyzing'
                    ? 'Turning your idea into a part…'
                    : 'Up to 30 seconds. Keep it simple.'}
              </p>
            </div>
            {mode === 'touch' && phase === 'recording' && (
              <button className="button primary full" onClick={finishTaps}>
                <Check size={18} /> Hear my beat
              </button>
            )}
            {mode === 'mic' && micReady && !busy && (
              <button
                className="text-button"
                onClick={() =>
                  phase === 'recording' ? stopMic() : void startMic()
                }
              >
                {phase === 'recording'
                  ? 'Finish recording'
                  : 'Or click to start, then click to finish'}
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
              <div className="preview-part">
                <div className="mini-notes" aria-hidden="true">
                  {draft.events.slice(0, 40).map((e, i) => (
                    <i
                      key={i}
                      style={{
                        height: `${15 + e.velocity * 38}px`,
                        background:
                          instrument === 'piano' ? '#c7bdf5' : '#f2c276',
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
                  onKeep(draft, context.current!);
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
