'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  Download,
  Headphones,
  LoaderCircle,
  Mic,
  Play,
  RotateCcw,
  Square,
} from 'lucide-react';
import { AudioEngine } from '@/lib/music/audio';
import {
  beginCapture,
  microphoneError,
  type CaptureSession,
} from '@/lib/music/capture';
import { AnalysisClient } from '@/lib/music/analysis-client';
import { cleanHumIntent } from '@/lib/music/phrase-cleanup';
import { encodeWav } from '@/lib/music/wav';
import { download, safeFilename } from '@/lib/music/storage';
import { pauseOtherAudio } from '@/lib/music/media';
import {
  MELODIES,
  VOCAL_STYLES,
  DISTANCES,
  melodyScore,
  noteName,
  referenceTrack,
  trialKey,
  audioQuality,
  type LabSession,
  type LabTake,
  type VocalStyle,
  type ReferenceNote,
} from '@/lib/voice-lab/protocol';
import { latestLab, saveLab, exportLab } from '@/lib/voice-lab/storage';
import {
  mixNoise,
  syntheticNoise,
  type NoiseKind,
} from '@/lib/voice-lab/noise';
import { MelodyScore } from './melody-score';
import { LabAudio } from './lab-audio';

type Phase =
  | 'idle'
  | 'listening'
  | 'preparing'
  | 'countdown'
  | 'recording'
  | 'review';
function newSession(): LabSession {
  return {
    version: 1,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    singer: '',
    microphone: '',
    room: '',
    takes: [],
  };
}
export default function TuningCenter() {
  const [session, setSession] = useState<LabSession | null>(null);
  const [index, setIndex] = useState(0);
  const [style, setStyle] = useState<VocalStyle>('hmm');
  const [distance, setDistance] = useState(15);
  const [root, setRoot] = useState(48);
  const [bpm, setBpm] = useState(90);
  const [split, setSplit] = useState<'dev' | 'heldout'>('dev');
  const [listening, setListening] = useState<'headphones' | 'speakers'>(
    'headphones',
  );
  const [guide, setGuide] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [position, setPosition] = useState(0);
  const [level, setLevel] = useState(0);
  const [draft, setDraft] = useState<LabTake | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('Opening your recordings…');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [detection, setDetection] = useState<{
    notes: ReferenceNote[];
    cleaned: ReferenceNote[];
    label: string;
  } | null>(null);
  const [noise, setNoise] = useState<'clean' | NoiseKind>('clean');
  const [snr, setSnr] = useState(20);
  const [seed, setSeed] = useState(1);
  const [listeningToNotes, setListeningToNotes] = useState<
    false | 'raw' | 'cleaned'
  >(false);
  const [engine] = useState(() => new AudioEngine());
  const [analyzer] = useState(() => new AnalysisClient());
  const capture = useRef<CaptureSession | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const serial = useRef(0);
  const listenReturnPhase = useRef<'idle' | 'review'>('idle');
  const analyzeSerial = useRef(0);
  const cancelAnalysis = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [comparisonBlob, setComparisonBlob] = useState<Blob | null>(null);
  const melody = MELODIES[index];
  const score = melodyScore(melody, root, bpm);
  const vocal = VOCAL_STYLES.find((item) => item.id === style)!;
  const locked = phase !== 'idle';
  const currentKey = trialKey(
    melody.id,
    style,
    distance,
    root,
    bpm,
    split,
    guide,
    listening,
    session,
  );
  const saved = session?.takes
    .filter((take) => take.trialKey === currentKey)
    .at(-1);
  const take = draft ?? saved;
  const completed = new Set(session?.takes.map((take) => take.trialKey));
  const progress = MELODIES.filter((item) =>
    completed.has(
      trialKey(
        item.id,
        style,
        distance,
        root,
        bpm,
        split,
        guide,
        listening,
        session,
      ),
    ),
  ).length;
  const activeNote = score.notes.find(
    (note) => position >= note.time && position < note.time + note.duration,
  );
  const timed =
    phase === 'recording' || phase === 'listening' || phase === 'countdown';
  useEffect(() => {
    mounted.current = true;
    latestLab()
      .then((saved) => {
        if (mounted.current) {
          setSession(saved ?? newSession());
          setNotice(
            saved ? 'Your recordings are back.' : 'Ready for your first take.',
          );
        }
      })
      .catch(() => {
        if (mounted.current) {
          setSession(newSession());
          setError(
            'Browser storage is unavailable. Export your session before leaving.',
          );
        }
      });
    return () => {
      mounted.current = false;
      // This ref counts operations, rather than pointing to a React node.
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      serial.current++;
      capture.current?.cancel();
      if (timer.current) clearInterval(timer.current);
      analyzer.dispose();
      void engine.close();
    };
  }, [engine, analyzer]);
  function clearClock() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }
  function stopSound() {
    engine.stop();
    pauseOtherAudio();
    setListeningToNotes(false);
  }
  function clearAnalysis() {
    analyzeSerial.current++;
    cancelAnalysis.current?.();
    cancelAnalysis.current = null;
    setAnalyzing(false);
    setDetection(null);
    setComparisonBlob(null);
  }
  function cancel() {
    serial.current++;
    capture.current?.cancel();
    capture.current = null;
    clearClock();
    clearAnalysis();
    stopSound();
    setPosition(0);
    setLevel(0);
    setPhase('idle');
    setDraft(null);
  }
  function changeCondition(change: () => void) {
    clearAnalysis();
    stopSound();
    setPosition(0);
    setComment('');
    change();
  }
  async function persist(next: LabSession) {
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(() => saveLab(next));
    await saveQueue.current;
  }
  async function listen() {
    if (phase === 'listening') {
      serial.current++;
      clearClock();
      stopSound();
      setPosition(0);
      setPhase(listenReturnPhase.current);
      return;
    }
    listenReturnPhase.current = draft ? 'review' : 'idle';
    stopSound();
    setError('');
    setPhase('listening');
    setPosition(0);
    const token = ++serial.current;
    try {
      const playback = await engine.play(
        [referenceTrack(score.notes, score.duration)],
        false,
        () => {
          if (mounted.current && token === serial.current) {
            clearClock();
            setPhase(listenReturnPhase.current);
            setPosition(0);
          }
        },
      );
      if (!playback || token !== serial.current || !mounted.current) return;
      timer.current = setInterval(
        () => setPosition(Math.max(0, engine.currentTime - playback.startAt)),
        25,
      );
    } catch (e) {
      if (mounted.current && token === serial.current) {
        setError(microphoneError(e));
        setPhase(listenReturnPhase.current);
      }
    }
  }
  async function record(retry = false) {
    if (!session || (phase !== 'idle' && !(retry && phase === 'review')))
      return;
    stopSound();
    clearAnalysis();
    setError('');
    setDraft(null);
    setComment('');
    setPhase('preparing');
    const token = ++serial.current;
    // Snapshot the condition before asking for microphone access.
    const metadata = {
      setup: {
        singer: session.singer,
        microphone: session.microphone,
        room: session.room,
      },
      melodyId: melody.id,
      style,
      distanceCm: distance,
      root,
      bpm,
      split,
      guideDuringRecording: guide,
      listening,
      trialKey: currentKey,
      reference: score.notes,
    };
    try {
      const recording = await beginCapture(
        engine,
        (meter, elapsed) => {
          if (mounted.current && token === serial.current) {
            setLevel(meter);
            setPosition(elapsed);
          }
        },
        (pcm, rate) => {
          if (!mounted.current || token !== serial.current) return;
          clearClock();
          capture.current = null;
          stopSound();
          setLevel(0);
          const samples = pcm.slice(0, Math.round(score.duration * rate));
          if (samples.length < (score.duration - 0.1) * rate) {
            setError(
              'The microphone stopped before the exercise finished. Please record it again.',
            );
            setPhase('idle');
            return;
          }
          setDraft({
            ...metadata,
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            referenceKind: 'prompt-score',
            duration: samples.length / rate,
            sampleRate: rate,
            audio: encodeWav([samples], rate),
            ...audioQuality(samples),
            note: '',
          });
          setPosition(0);
          setPhase('review');
          setNotice('Listen back. Keep this take or try again.');
        },
      );
      if (!mounted.current || token !== serial.current) {
        recording.cancel();
        return;
      }
      capture.current = recording;
      if (guide)
        await engine.play(
          [referenceTrack(score.notes, score.duration)],
          false,
          () => {},
          recording.startAt,
        );
      if (!mounted.current || token !== serial.current) return;
      if (recording.currentTime() >= recording.startAt)
        throw new Error(
          'Audio took too long to prepare. Try again for a fresh count-in.',
        );
      setPhase('countdown');
      const tick = () => {
        if (!mounted.current || token !== serial.current) return;
        const elapsed = recording.currentTime() - recording.startAt;
        setPosition(elapsed);
        if (elapsed >= 0) setPhase('recording');
        if (elapsed >= score.duration) {
          clearClock();
          recording.stop();
        }
      };
      tick();
      timer.current = setInterval(tick, 25);
    } catch (e) {
      if (mounted.current && token === serial.current) {
        cancel();
        setError(microphoneError(e));
      }
    }
  }
  async function keep(nextMelody: boolean) {
    if (!session || !draft || saving) return;
    serial.current++;
    clearClock();
    stopSound();
    clearAnalysis();
    setSaving(true);
    const next = {
      ...session,
      takes: [...session.takes, { ...draft, note: comment }],
    };
    setSession(next);
    try {
      await persist(next);
      setNotice(
        'Take saved in this browser. Earlier kept takes are preserved.',
      );
    } catch {
      setError(
        'The take is kept in this tab, but could not be saved to this browser. Export the session before leaving.',
      );
    } finally {
      if (mounted.current) {
        setDraft(null);
        setPhase('idle');
        setSaving(false);
        setComment('');
        if (nextMelody) setIndex((index + 1) % MELODIES.length);
      }
    }
  }
  async function exportSession() {
    if (!session) return;
    setExporting(true);
    try {
      download(
        await exportLab(session),
        `tuning-${safeFilename(session.singer || 'session')}-${session.id.slice(0, 8)}.json`,
      );
    } catch (e) {
      setError(microphoneError(e));
    } finally {
      if (mounted.current) setExporting(false);
    }
  }
  async function analyze() {
    if (!take) return;
    stopSound();
    clearAnalysis();
    setError('');
    setAnalyzing(true);
    const token = ++analyzeSerial.current;
    try {
      const context = await engine.ready();
      const decoded = await context.decodeAudioData(
        await take.audio.arrayBuffer(),
      );
      const pcm = decoded.getChannelData(0).slice();
      const input =
        noise === 'clean'
          ? pcm
          : mixNoise(
              pcm,
              syntheticNoise(pcm.length, decoded.sampleRate, noise, seed),
              snr,
            ).pcm;
      if (!mounted.current || token !== analyzeSerial.current) return;
      setComparisonBlob(encodeWav([input], decoded.sampleRate));
      const task = analyzer.analyze(input, decoded.sampleRate, 'hum');
      cancelAnalysis.current = task.cancel;
      const intent = await task.result;
      const cleaned = cleanHumIntent(intent, {
        tempo: take.bpm,
        key: 0,
        mode: 'major',
        confidence: 1,
      });
      if (mounted.current && token === analyzeSerial.current)
        setDetection({
          notes: intent.events.flatMap((event) =>
            event.pitch === null
              ? []
              : [
                  {
                    time: event.time,
                    duration: event.duration,
                    pitch: event.pitch,
                  },
                ],
          ),
          cleaned: cleaned.events.flatMap((event) =>
            event.pitch === null
              ? []
              : [
                  {
                    time: event.time,
                    duration: event.duration,
                    pitch: event.pitch,
                  },
                ],
          ),
          label: `${noise === 'clean' ? 'Clean recording' : `${noise === 'hiss' ? 'Synthetic hiss' : 'Synthetic rumble'} · ${snr} dB SNR · seed ${seed}`} · ${intent.analyzer ?? 'local detector'}`,
        });
    } catch (e) {
      if (mounted.current && token === analyzeSerial.current)
        setError(microphoneError(e));
    } finally {
      if (mounted.current && token === analyzeSerial.current) {
        setAnalyzing(false);
        cancelAnalysis.current = null;
      }
    }
  }
  async function hearDetection(version: 'raw' | 'cleaned' = 'raw') {
    if (!take || !detection) return;
    if (listeningToNotes === version) {
      stopSound();
      return;
    }
    stopSound();
    setListeningToNotes(version);
    try {
      await engine.play(
        [
          referenceTrack(
            version === 'cleaned' ? detection.cleaned : detection.notes,
            Math.max(
              take.duration,
              ...detection.cleaned.map((n) => n.time + n.duration),
            ),
          ),
        ],
        false,
        () => {
          if (mounted.current) setListeningToNotes(false);
        },
      );
    } catch (e) {
      setListeningToNotes(false);
      setError(microphoneError(e));
    }
  }
  return (
    <main className="tuning-center">
      <header className="lab-header">
        <Link href="/" className="text-button">
          <ArrowLeft size={17} /> Back to my songs
        </Link>
        <button
          className="button"
          disabled={!session?.takes.length || exporting}
          onClick={() => void exportSession()}
        >
          {exporting ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Download size={17} />
          )}{' '}
          Export session ({session?.takes.length ?? 0} takes)
        </button>
      </header>
      <div className="lab-intro">
        <p className="eyebrow">LISTEN. MATCH. TRY AGAIN.</p>
        <h1>Tuning Center</h1>
        <p>
          Fifteen little melodies. Help us turn real, imperfect humming into
          better music.
        </p>
      </div>
      <details className="lab-session-details">
        <summary>Your recording setup</summary>
        <p>
          Keep this setup consistent for a pass. Everything stays in this
          browser until you export it.
        </p>
        <div className="lab-fields">
          {(['singer', 'microphone', 'room'] as const).map((field) => (
            <label key={field}>
              {field === 'singer'
                ? 'Singer nickname'
                : field === 'microphone'
                  ? 'Microphone / device'
                  : 'Room / background sound'}
              <input
                disabled={!session || locked}
                value={session?.[field] ?? ''}
                maxLength={120}
                placeholder={
                  field === 'singer'
                    ? 'e.g. Ryan'
                    : field === 'microphone'
                      ? 'e.g. laptop microphone'
                      : 'e.g. office, fan off'
                }
                onChange={(event) => {
                  if (session) {
                    clearAnalysis();
                    stopSound();
                    setSession({ ...session, [field]: event.target.value });
                  }
                }}
                onBlur={() => {
                  if (session)
                    void persist(session).catch(() =>
                      setError('Could not save setup. Export before leaving.'),
                    );
                }}
              />
            </label>
          ))}
        </div>
      </details>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <div className="lab-layout">
        <aside className="lab-melodies" aria-label="Choose a melody">
          <div>
            <strong>Your melody book</strong>
            <span>{progress} / 15 kept with this setup</span>
          </div>
          {MELODIES.map((item, i) => (
            <button
              key={item.id}
              disabled={locked}
              aria-pressed={index === i}
              onClick={() => changeCondition(() => setIndex(i))}
            >
              <span>{String(i + 1).padStart(2, '0')}</span>
              <strong>{item.name}</strong>
              {completed.has(
                trialKey(
                  item.id,
                  style,
                  distance,
                  root,
                  bpm,
                  split,
                  guide,
                  listening,
                  session,
                ),
              ) && <Check size={16} aria-label="Take saved" />}
            </button>
          ))}
        </aside>
        <section className="lab-exercise" aria-label="Current exercise">
          <div className="lab-exercise-title">
            <p className="eyebrow">MELODY {index + 1} OF 15</p>
            <h2>{melody.name}</h2>
            <p>{melody.purpose}</p>
          </div>
          <fieldset className="lab-styles" disabled={locked}>
            <legend>How to sing this take</legend>
            {VOCAL_STYLES.map((item) => (
              <button
                key={item.id}
                aria-pressed={style === item.id}
                onClick={() => changeCondition(() => setStyle(item.id))}
              >
                {item.short}
              </button>
            ))}
          </fieldset>
          <div className="lab-style-help">
            <strong>{vocal.label}</strong>
            <p>{vocal.instruction}</p>
          </div>
          <div className="lab-fields">
            <label>
              Microphone distance
              <select
                value={distance}
                disabled={locked}
                onChange={(event) =>
                  changeCondition(() => setDistance(Number(event.target.value)))
                }
              >
                {DISTANCES.map((item) => (
                  <option key={item.cm} value={item.cm}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Starting pitch
              <select
                value={root}
                disabled={locked}
                onChange={(event) =>
                  changeCondition(() => setRoot(Number(event.target.value)))
                }
              >
                {[43, 45, 48, 50, 53, 55, 57, 60, 62, 65].map((pitch) => (
                  <option key={pitch} value={pitch}>
                    {noteName(pitch)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Pace
              <select
                value={bpm}
                disabled={locked}
                onChange={(event) =>
                  changeCondition(() => setBpm(Number(event.target.value)))
                }
              >
                {[60, 75, 90, 105, 120].map((value) => (
                  <option key={value} value={value}>
                    {value} BPM
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="lab-help">
            Listen first. Choose a comfortable starting pitch, then try to match
            the notes and pace. The bars under the notes show how long to hold
            them; gaps mean silence.
          </p>
          <MelodyScore
            notes={score.notes}
            duration={score.duration}
            beat={score.beat}
            position={position}
            active={timed && position >= 0}
          />
          <div className="lab-cue" data-recording={phase === 'recording'}>
            <div>
              <span>
                {phase === 'preparing'
                  ? 'Preparing your microphone…'
                  : phase === 'countdown'
                    ? 'Get ready'
                    : phase === 'recording'
                      ? 'Recording'
                      : phase === 'listening'
                        ? 'Listen and follow'
                        : phase === 'review'
                          ? 'How did that feel?'
                          : 'Your turn when you’re ready'}
              </span>
              <strong>
                {phase === 'countdown'
                  ? Math.min(3, Math.max(1, Math.ceil(-position)))
                  : timed
                    ? activeNote
                      ? `${vocal.short} · ${noteName(activeNote.pitch)}`
                      : position < 1
                        ? 'Ready…'
                        : position >=
                            score.notes.at(-1)!.time +
                              score.notes.at(-1)!.duration
                          ? 'Let it finish'
                          : 'Rest'
                    : phase === 'review'
                      ? 'Listen back below'
                      : `${noteName(root)} · ${bpm} BPM`}
              </strong>
            </div>
            <div className="lab-level" aria-label="Microphone level">
              <i style={{ height: `${Math.min(100, level * 500)}%` }} />
            </div>
          </div>
          <div className="lab-monitoring">
            <label>
              Listening through
              <select
                disabled={locked}
                value={listening}
                onChange={(event) =>
                  changeCondition(() => {
                    const next = event.target.value as
                      | 'headphones'
                      | 'speakers';
                    setListening(next);
                    if (next === 'speakers') setGuide(false);
                  })
                }
              >
                <option value="headphones">Headphones</option>
                <option value="speakers">Speakers</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={guide}
                disabled={locked || listening === 'speakers'}
                onChange={(event) =>
                  changeCondition(() => setGuide(event.target.checked))
                }
              />{' '}
              Play the melody while I record
            </label>
          </div>
          <p className="lab-help">
            <Headphones size={15} />{' '}
            {listening === 'headphones'
              ? 'Headphones keep the reference out of your recording. Leave the first and last second quiet.'
              : 'Listen first, then record with the visual guide. Reference sound is off during capture to keep speaker audio out of the take.'}
          </p>
          <div className="lab-actions">
            {(phase === 'idle' ||
              phase === 'listening' ||
              phase === 'review') && (
              <button
                className="button"
                disabled={!session}
                onClick={() => void listen()}
              >
                {phase === 'listening' ? (
                  <Square size={17} />
                ) : (
                  <Play size={17} />
                )}
                {phase === 'listening' ? 'Stop reference' : 'Hear the melody'}
              </button>
            )}
            {phase === 'idle' && (
              <button
                className="button primary"
                disabled={!session}
                onClick={() => void record()}
              >
                {saved ? <RotateCcw size={17} /> : <Mic size={17} />}
                {saved ? 'Rerecord this exercise' : 'Record my take'}
              </button>
            )}
            {['preparing', 'countdown', 'recording'].includes(phase) && (
              <button className="button" onClick={cancel}>
                <Square size={17} /> Cancel take
              </button>
            )}
          </div>
          {take &&
            (phase === 'idle' ||
              phase === 'review' ||
              phase === 'listening') && (
              <section className="lab-review" aria-label="Review your take">
                <h3>{draft ? 'Your new take' : 'Your last kept take'}</h3>
                <LabAudio
                  blob={take.audio}
                  label="Your microphone recording"
                  onPlay={(audio) => {
                    engine.stop();
                    clearClock();
                    serial.current++;
                    if (phase === 'listening')
                      setPhase(draft ? 'review' : 'idle');
                    setListeningToNotes(false);
                    pauseOtherAudio(audio);
                  }}
                />
                <p className="lab-help">
                  {take.rms < 0.003
                    ? 'This recording is very quiet. Check the microphone or move closer, then try again.'
                    : take.clippedFraction > 0.001
                      ? 'Some audio hit the recording limit. Try a little less input gain or move farther away.'
                      : 'Listen for missed notes, extra syllables, and the held endings. Mistakes are useful—write down what happened.'}
                </p>
                {draft && (
                  <>
                    <label className="lab-note">
                      Notes about this take
                      <input
                        value={comment}
                        maxLength={300}
                        placeholder="e.g. started late, lost the high note, chair squeaked"
                        onChange={(event) => setComment(event.target.value)}
                      />
                    </label>
                    <div className="lab-actions">
                      <button
                        className="button"
                        disabled={saving}
                        onClick={() => void record(true)}
                      >
                        <RotateCcw size={17} /> Try again
                      </button>
                      <button
                        className="button"
                        disabled={saving}
                        onClick={() => void keep(false)}
                      >
                        Keep this take
                      </button>
                      <button
                        className="button primary"
                        disabled={saving}
                        onClick={() => void keep(true)}
                      >
                        <Check size={17} /> Keep & next melody
                      </button>
                    </div>
                    <p className="lab-help">
                      Rerecording keeps your earlier saved takes. This draft is
                      saved only when you keep it.
                    </p>
                  </>
                )}
                <details className="lab-analysis">
                  <summary>Test the detector & add background noise</summary>
                  <p className="lab-help">
                    These are synthetic noise tests on a copy. Your microphone
                    recording stays intact. Check-set takes are reserved for the
                    offline evaluation.
                  </p>
                  <div className="lab-fields">
                    <label>
                      Noise
                      <select
                        value={noise}
                        disabled={analyzing}
                        onChange={(event) => {
                          clearAnalysis();
                          setNoise(event.target.value as typeof noise);
                        }}
                      >
                        <option value="clean">None · clean recording</option>
                        <option value="hiss">Synthetic room hiss</option>
                        <option value="rumble">
                          Synthetic fan-like rumble
                        </option>
                      </select>
                    </label>
                    <label>
                      Voice above noise
                      <select
                        value={snr}
                        disabled={analyzing || noise === 'clean'}
                        onChange={(event) => {
                          clearAnalysis();
                          setSnr(Number(event.target.value));
                        }}
                      >
                        <option value={20}>20 dB · mild</option>
                        <option value={10}>10 dB · noticeable</option>
                        <option value={0}>0 dB · equal power</option>
                      </select>
                    </label>
                    <button
                      className="button"
                      disabled={analyzing || noise === 'clean'}
                      onClick={() => {
                        clearAnalysis();
                        setSeed(seed + 1);
                      }}
                    >
                      New noise pattern
                    </button>
                  </div>
                  <button
                    className="button"
                    disabled={
                      analyzing ||
                      take.split === 'heldout' ||
                      (phase !== 'idle' && phase !== 'review')
                    }
                    onClick={() => void analyze()}
                  >
                    {analyzing ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Play size={17} />
                    )}
                    {analyzing ? 'Finding the notes…' : 'Run detector'}
                  </button>
                  {comparisonBlob && (
                    <div className="lab-noisy-preview">
                      <span>Audio sent to the detector</span>
                      <LabAudio
                        blob={comparisonBlob}
                        label="Audio sent to the detector"
                        onPlay={(audio) => {
                          engine.stop();
                          clearClock();
                          serial.current++;
                          if (phase === 'listening')
                            setPhase(draft ? 'review' : 'idle');
                          setListeningToNotes(false);
                          pauseOtherAudio(audio);
                        }}
                      />
                    </div>
                  )}
                  {detection && (
                    <div className="lab-detection">
                      <p>{detection.label}</p>
                      <strong>
                        {detection.notes.length} detected notes ·{' '}
                        {detection.cleaned.length} after cleanup ·{' '}
                        {take.reference.length} in the guide
                      </strong>
                      <p className="lab-help">
                        The guide is what you aimed for, not a verified
                        transcript of your voice. This is a listening
                        comparison, not an accuracy score.
                      </p>
                      <button
                        className="button"
                        disabled={!detection.notes.length}
                        onClick={() => void hearDetection()}
                      >
                        {listeningToNotes === 'raw'
                          ? 'Stop detected melody'
                          : 'Hear detected melody'}
                      </button>
                      <button
                        className="button"
                        disabled={!detection.cleaned.length}
                        onClick={() => void hearDetection('cleaned')}
                      >
                        {listeningToNotes === 'cleaned'
                          ? 'Stop cleaned phrase'
                          : 'Hear cleaned phrase'}
                      </button>
                      <p className="lab-help">
                        Cleanup uses your recorded {take.bpm} BPM, joins pitch
                        settling, and fits notes and rests to a steady rhythm.
                        It does not use the guide’s notes.
                      </p>
                      <div className="lab-note-list">
                        {detection.notes.map((note, i) => (
                          <span key={i}>
                            {noteName(note.pitch)}{' '}
                            <small>
                              {note.time.toFixed(2)}s ·{' '}
                              {note.duration.toFixed(2)}
                              s long
                            </small>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </details>
              </section>
            )}
          <details className="lab-session-details">
            <summary>Save fresh takes for a later check</summary>
            <p>
              Start with the tuning set. When we have a candidate improvement,
              record a fresh check set without using its results to adjust the
              detector. All noise versions of a take stay in the same set.
            </p>
            <label>
              Recording set
              <select
                disabled={locked}
                value={split}
                onChange={(event) =>
                  changeCondition(() =>
                    setSplit(event.target.value as typeof split),
                  )
                }
              >
                <option value="dev">Tuning set</option>
                <option value="heldout">Fresh check set</option>
              </select>
            </label>
          </details>
          <output className="lab-status">{notice}</output>
        </section>
      </div>
    </main>
  );
}
