'use client';
import { useEffect, useRef } from 'react';
export function LabAudio({
  blob,
  label,
  onPlay,
}: {
  blob: Blob;
  label: string;
  onPlay: (audio: HTMLAudioElement) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    if (audio.current) audio.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  // Hummed syllables have no spoken dialogue; the reference notes are shown in the score.
  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption
    <audio
      ref={audio}
      aria-label={label}
      controls
      onPlay={(event) => onPlay(event.currentTarget)}
    />
  );
}
