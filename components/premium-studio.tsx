'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  Cpu,
  Download,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { AudioComparison, type ComparisonSource } from './audio-comparison';
import { pauseOtherAudio } from '@/lib/music/media';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { Slider } from './ui/slider';
import type { AudioEngine } from '@/lib/music/audio';
import { arrangedTracks } from '@/lib/music/composition';
import { download, safeFilename } from '@/lib/music/storage';
import type { PremiumTake, Song } from '@/lib/music/types';
import {
  renderMetadata,
  songFingerprint,
  matchesSong,
  studioFetch,
  type RenderJob,
} from '@/lib/premium/client';

export function PremiumStudio({
  song,
  engine,
  onKeep,
  onBeforePlay,
  originalPlaying,
}: {
  song: Song;
  engine: AudioEngine;
  onKeep: (take: PremiumTake) => void;
  onBeforePlay: () => void;
  originalPlaying: boolean;
}) {
  const [mode, setMode] = useState<'premium' | 'free'>('premium');
  const [service, setService] = useState<{
    premium: boolean;
    ready: boolean;
  } | null>(null);
  const [comparison, setComparison] = useState<ComparisonSource[] | null>(null);
  const [direction, setDirection] = useState('');
  const [strength, setStrength] = useState(0.8);
  const [job, setJob] = useState<RenderJob | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [takeIndex, setTakeIndex] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const keepTake = useEffectEvent(onKeep);
  const fingerprint = useRef('');
  const mounted = useRef(true);
  const storageKey = 'tapcomposer-render-' + song.id;
  const take = song.premiumTakes?.[takeIndex] ?? song.premiumTakes?.[0];
  const audible = arrangedTracks(song).some(
    (track) => !track.muted && track.events.length > 0,
  );
  const busy =
    preparing ||
    (!!job && (job.state === 'queued' || job.state === 'rendering'));
  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => {
      if (!mounted.current) return;
      try {
        const mode = localStorage.getItem('tapcomposer-service');
        if (mode === 'free') setMode('free');
        const saved = JSON.parse(
          localStorage.getItem(storageKey) ?? 'null',
        ) as {
          job: RenderJob;
          fingerprint: string;
        } | null;
        if (saved && /^[a-f0-9-]{36}$/.test(saved.job.id)) {
          fingerprint.current = saved.fingerprint;
          setJob(saved.job);
        }
      } catch {
        /* Browser storage is optional. */
      }
    });
    return () => {
      mounted.current = false;
    };
  }, [storageKey]);
  useEffect(() => {
    if (mode === 'free') return;
    let live = true;
    const check = () =>
      void studioFetch<{ premium: boolean; ready: boolean }>('status')
        .then((s) => {
          if (live) setService(s);
        })
        .catch(() => {
          if (live) setService({ premium: true, ready: false });
        });
    check();
    const timer = setInterval(check, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [mode]);
  useEffect(() => {
    if (!take) {
      audio.current?.removeAttribute('src');
      return;
    }
    const url = URL.createObjectURL(take.audio);
    if (audio.current) audio.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [take]);
  useEffect(() => {
    if (originalPlaying) audio.current?.pause();
  }, [originalPlaying]);
  useEffect(() => {
    if (
      !job ||
      job.state === 'failed' ||
      job.state === 'ready' ||
      mode === 'free'
    )
      return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await studioFetch<RenderJob>('jobs/' + job!.id, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setElapsed(Math.floor((Date.now() - next.createdAt) / 1000));
        if (next.state === 'failed') {
          setError(
            next.error ?? 'The render did not finish. Please try again.',
          );
          setJob(next);
          try {
            localStorage.removeItem(storageKey);
          } catch {
            /* Storage is optional. */
          }
          return;
        }
        if (next.state === 'ready') {
          const response = await fetch(
            '/api/premium/jobs/' + next.id + '/audio',
            { signal: controller.signal },
          );
          if (!response.ok)
            throw new Error(
              'Your take is ready, but could not be downloaded. Try reconnecting.',
            );
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          keepTake({
            id: next.id,
            createdAt: next.createdAt,
            duration: next.duration,
            fingerprint: fingerprint.current,
            audio: blob,
          });
          setTakeIndex(0);
          setJob(next);
          setError('');
          try {
            localStorage.removeItem(storageKey);
          } catch {
            /* Storage is optional. */
          }
          return;
        }
        setJob((current) => (current?.state === next.state ? current : next));
        setError('');
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(
          e instanceof Error ? e.message : 'Reconnecting to the studio…',
        );
      }
      timer = setTimeout(() => void poll(), 3000);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [job, mode, storageKey]);
  async function render() {
    onBeforePlay();
    audio.current?.pause();
    setPreparing(true);
    setError('');
    const metadata = renderMetadata(song, direction, strength);
    const sourceFingerprint = songFingerprint(song);
    try {
      if (metadata.duration < 10 || metadata.duration > 181)
        throw new Error(
          'Give the demo a song between 10 seconds and three minutes. Adjust its sections, then try again.',
        );
      const blob = await engine.exportWav(arrangedTracks(song));
      if (!mounted.current) return;
      const next = await studioFetch<RenderJob>('render', {
        method: 'POST',
        body: blob,
        headers: {
          'Content-Type': 'audio/wav',
          'X-TapComposer-Arrangement': encodeURIComponent(
            JSON.stringify(metadata),
          ),
        },
      });
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ job: next, fingerprint: sourceFingerprint }),
        );
      } catch {
        /* Render still works without storage. */
      }
      if (!mounted.current) return;
      fingerprint.current = sourceFingerprint;
      setJob(next);
      setElapsed(0);
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error
            ? e.message
            : 'The studio could not start. Please try again.',
        );
    } finally {
      if (mounted.current) setPreparing(false);
    }
  }
  return (
    <section className="premium-studio" aria-label="Studio performance">
      <div className="premium-heading">
        <div>
          <p className="eyebrow">
            <Sparkles size={14} /> YOUR IDEA, FULLY HEARD
          </p>
          <h3>
            {mode === 'premium'
              ? 'Give your song a studio finish.'
              : 'Your studio. On your device.'}
          </h3>
        </div>
        <Select
          disabled={preparing}
          value={mode}
          onValueChange={(value) => {
            if (value === 'free' || value === 'premium') {
              setMode(value);
              try {
                localStorage.setItem('tapcomposer-service', value);
              } catch {}
            }
          }}
        >
          <SelectTrigger
            aria-label="Service experience"
            className="service-select"
          >
            <SelectValue>
              {mode === 'premium' ? 'Premium demo' : 'Free · local'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="premium">Premium demo</SelectItem>
            <SelectItem value="free">Free · local</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {mode === 'free' ? (
        <p className="premium-description">
          <ShieldCheck size={17} /> Record, auto-compose, change instruments,
          arrange and export on this device. No audio uploads.{' '}
          {busy
            ? 'Your previously submitted premium take can continue on the service; switch back to collect it.'
            : ''}
        </p>
      ) : (
        <>
          <p className="premium-description">
            An expressive AI performance, built from your melody and
            arrangement. Your editable song stays yours.
          </p>
          {!!song.tracks.length && (
            <>
              <div className="premium-direction">
                <label htmlFor="studio-direction">
                  Give it a feeling <span>optional</span>
                </label>
                <input
                  id="studio-direction"
                  value={direction}
                  maxLength={400}
                  onChange={(e) => setDirection(e.target.value)}
                  placeholder="Warm piano, intimate strings, a gentle late-night groove…"
                />
                <details className="gentle-details">
                  <summary>How closely should it follow my song?</summary>
                  <p>
                    Lower allows more reinterpretation; higher asks the
                    performance to stay closer to your arrangement.
                  </p>
                  <div className="fidelity-label">
                    <span>More adventurous</span>
                    <span>Closer to my song</span>
                  </div>
                  <Slider
                    aria-label="Follow my arrangement"
                    min={0.5}
                    max={1}
                    step={0.05}
                    value={[strength]}
                    onValueChange={(v) =>
                      setStrength(Array.isArray(v) ? v[0] : v)
                    }
                  />
                </details>
              </div>
              <div className="premium-actions">
                <button
                  className="button primary"
                  disabled={busy || !service?.ready || !audible}
                  onClick={() => void render()}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <Sparkles size={18} />
                  )}{' '}
                  {preparing
                    ? 'Preparing your arrangement…'
                    : busy
                      ? job?.state === 'queued'
                        ? 'Waiting for the studio…'
                        : 'Performing your song…'
                      : 'Make a studio take'}
                </button>
                <output className="studio-status" aria-live="polite">
                  {busy
                    ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')} · You can keep arranging`
                    : service === null
                      ? 'Connecting…'
                      : service.ready
                        ? 'Premium demo · local GPU'
                        : service.premium
                          ? 'Studio offline · local composing still works'
                          : 'Premium service is not connected'}
                </output>
              </div>
              <p className="premium-privacy">
                <Cpu size={13} /> Sends this arrangement and your direction to
                the GPU service on this computer. Finished takes are saved in
                this browser. Up to 3 minutes per take.
              </p>
            </>
          )}
          {!song.tracks.length && (
            <p className="premium-empty">
              Start with a tap, a hum, or the example below. We’ll handle the
              tempo, harmony and song structure, then bring it to life.
            </p>
          )}
          {error && (
            <p className="error-box" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      {take && (
        <div className="studio-take">
          <div className="take-heading">
            <strong>
              <Sparkles size={16} /> Your studio take
            </strong>
            <Select
              value={String(takeIndex)}
              onValueChange={(v) => {
                if (v) setTakeIndex(Number(v));
              }}
            >
              <SelectTrigger aria-label="Choose studio take">
                <SelectValue>
                  Take {(song.premiumTakes?.length ?? 1) - takeIndex}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {song.premiumTakes?.map((t, i) => (
                  <SelectItem key={t.id} value={String(i)}>
                    Take {song.premiumTakes!.length - i}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              className="text-button"
              onClick={() =>
                download(take.audio, `${safeFilename(song.name)}-studio.wav`)
              }
            >
              <Download size={16} /> Save WAV
            </button>
          </div>
          <button
            className="button"
            disabled={!audible}
            onClick={() => {
              audio.current?.pause();
              onBeforePlay();
              setComparison([
                { id: 'arrangement', label: 'Editable arrangement', song },
                ...(song.premiumTakes ?? []).map((t, i) => ({
                  id: t.id,
                  label: `Studio take ${(song.premiumTakes?.length ?? 1) - i}`,
                  audio: t.audio,
                })),
              ]);
            }}
          >
            Compare at the same moment
          </button>
          <p className="take-explanation">
            Generated performance · a finished mix. Shape individual parts in
            the arrangement, then make another take.
          </p>
          {/* Instrumental music has no spoken content to caption. */}
          {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            ref={audio}
            controls
            autoPlay={take.id === 'premium-example'}
            preload="metadata"
            onPlay={(e) => {
              pauseOtherAudio(e.currentTarget);
              onBeforePlay();
            }}
          />
          {!matchesSong(take.fingerprint, song) && (
            <p>
              Your arrangement has changed. Make another take when you’re ready.
            </p>
          )}
        </div>
      )}
      <Dialog
        open={!!comparison}
        onOpenChange={(open) => {
          if (!open) setComparison(null);
        }}
      >
        <DialogContent className="app-dialog comparison-dialog">
          <DialogTitle>Which one feels like your song?</DialogTitle>
          <DialogDescription>
            Compare the current arrangement and saved performances at matching
            listening levels.
          </DialogDescription>
          {comparison && (
            <AudioComparison
              sources={comparison}
              engine={engine}
              onBeforePlay={onBeforePlay}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
