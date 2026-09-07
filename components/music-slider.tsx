'use client';
import { useId, useState } from 'react';
import { Slider } from './ui/slider';

/** Show the live value, but commit one musical edit when the gesture ends. */
export function MusicSlider({
  label,
  ariaLabel,
  value,
  min,
  max,
  step = 1,
  format = (n) => `${Math.round(n)}%`,
  ends,
  disabled,
  onCommit,
}: {
  label: string;
  ariaLabel?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  ends?: [string, string];
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<number | null>(null);
  const current = draft ?? value;
  return (
    <div className="music-slider">
      <div className="music-slider-label">
        <span id={id}>{label}</span>
        <output aria-hidden="true">{format(current)}</output>
      </div>
      <Slider
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : id}
        valueText={format}
        value={[current]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => setDraft(Array.isArray(v) ? v[0] : v)}
        onValueCommitted={(v) => {
          setDraft(null);
          const next = Array.isArray(v) ? v[0] : v;
          if (next !== value) onCommit(next);
        }}
      />
      {ends && (
        <div className="music-slider-ends" aria-hidden="true">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </div>
  );
}
