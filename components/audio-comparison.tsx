'use client';
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { AudioEngine } from '@/lib/music/audio';
import type { Song } from '@/lib/music/types';
import { pauseOtherAudio } from '@/lib/music/media';
import { arrangedTracks } from '@/lib/music/composition';
import {
  comparisonLevels,
  comparisonSeek,
  comparisonWav,
} from '@/lib/music/compare';
export interface ComparisonSource {
  id: string;
  label: string;
  song?: Song;
  audio?: Blob;
}
export function AudioComparison({
  sources,
  engine,
  onBeforePlay,
}: {
  sources: ComparisonSource[];
  engine: AudioEngine;
  onBeforePlay: () => void;
}) {
  const [prepared, setPrepared] = useState<
    { id: string; label: string; url: string }[]
  >([]);
  const [selected, setSelected] = useState(0),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const player = useRef<HTMLAudioElement>(null),
    pending = useRef({ at: 0, playing: false }),
    switching = useRef(false);
  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    async function prepare() {
      try {
        const buffers: AudioBuffer[] = [];
        // Sequential offline rendering bounds peak memory for longer songs.
        for (const source of sources) {
          const buffer = source.song
            ? await engine.render(arrangedTracks(source.song))
            : await (
                await engine.ready()
              ).decodeAudioData(await source.audio!.arrayBuffer());
          if (!live) return;
          buffers.push(buffer);
        }
        const gains = comparisonLevels(buffers);
        const result = buffers.map((buffer, i) => {
          const url = URL.createObjectURL(comparisonWav(buffer, gains[i]));
          urls.push(url);
          return { id: sources[i].id, label: sources[i].label, url };
        });
        if (live) setPrepared(result);
      } catch (e) {
        if (live)
          setError(
            e instanceof Error ? e.message : 'Could not prepare a comparison.',
          );
      }
    }
    void prepare();
    return () => {
      live = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [sources, engine]);
  function choose(index: number) {
    if (index === selected) return;
    const audio = player.current;
    if (!switching.current)
      pending.current = {
        at: audio?.currentTime ?? 0,
        playing: audio ? !audio.paused : false,
      };
    switching.current = true;
    setSelected(index);
  }
  return (
    <div className="audio-comparison">
      {error ? (
        <p className="error-box" role="alert">
          {error}
        </p>
      ) : !prepared.length ? (
        <output>
          <LoaderCircle className="spin" size={16} /> Preparing a fair
          comparison…
        </output>
      ) : (
        <>
          <fieldset
            className="comparison-choices"
            aria-label="Compare versions"
          >
            {prepared.map((source, i) => (
              <button
                key={source.id}
                className="button"
                aria-pressed={selected === i}
                onClick={() => choose(i)}
              >
                {source.label}
              </button>
            ))}
          </fieldset>
          {/* Instrumental music has no spoken content to caption. */}
          {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            ref={player}
            src={prepared[selected]?.url}
            controls
            onPlay={(e) => {
              setNotice('');
              pauseOtherAudio(e.currentTarget);
              onBeforePlay();
            }}
            onLoadedMetadata={() => {
              const audio = player.current;
              if (!audio) return;
              audio.currentTime = comparisonSeek(
                pending.current.at,
                audio.duration,
              );
              switching.current = false;
              if (pending.current.playing)
                void audio
                  .play()
                  .catch(() => setNotice('Press play to continue listening.'));
            }}
          />
          {notice && <output>{notice}</output>}
          <p>
            Switch at the same moment. Listening levels are matched; saved audio
            is unchanged.
          </p>
        </>
      )}
    </div>
  );
}
