'use client';
import { useRef, useState } from 'react';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import type { Song } from '@/lib/music/types';
import { shapeJourney } from '@/lib/music/direct';
export function JourneyEditor({
  song,
  onPropose,
}: {
  song: Song;
  onPropose: (label: string, next: Song) => void;
}) {
  const initial = (song.sections ?? []).map((s) => s.energy);
  const [values, setValues] = useState(initial),
    [resize, setResize] = useState(false);
  const gesture = useRef<{ values: number[]; last: number } | null>(null);
  const sections = song.sections ?? [];
  function draw(event: React.PointerEvent<SVGSVGElement>) {
    if (!gesture.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const index = Math.max(
      0,
      Math.min(
        sections.length - 1,
        Math.round(
          ((event.clientX - rect.left) / rect.width) * (sections.length - 1),
        ),
      ),
    );
    const energy = Math.max(
      0.1,
      Math.min(1, (1 - (event.clientY - rect.top) / rect.height) / 0.9),
    );
    const previous = gesture.current.last,
      next = [...gesture.current.values];
    const start = next[previous];
    for (let i = Math.min(previous, index); i <= Math.max(previous, index); i++)
      if (!sections[i].pinned)
        next[i] =
          previous === index
            ? energy
            : start + ((energy - start) * (i - previous)) / (index - previous);
    gesture.current = { values: next, last: index };
    setValues(next);
  }
  function preset(kind: 'rise' | 'middle' | 'settle') {
    const next = sections.map((s, i) => {
      const x = i / Math.max(1, sections.length - 1);
      return s.pinned
        ? s.energy
        : kind === 'rise'
          ? 0.25 + x * 0.7
          : kind === 'middle'
            ? 0.25 + Math.sin(x * Math.PI) * 0.7
            : 0.9 - x * 0.7;
    });
    setValues(initial);
    onPropose('Shape the journey', shapeJourney(song, next, resize));
  }
  return (
    <details className="gentle-details journey-editor">
      <summary>Shape the journey</summary>
      <p>
        Draw the rise and fall, or choose a shape. Kept sections stay as they
        are.
      </p>
      <svg
        viewBox="0 0 600 100"
        preserveAspectRatio="none"
        // SVG provides the interactive drawing surface; sliders provide keyboard control.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="img"
        aria-label="Draw song energy; section sliders below offer the same control"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          gesture.current = {
            values: [...values],
            last: Math.max(
              0,
              Math.min(
                sections.length - 1,
                Math.round(
                  (e.nativeEvent.offsetX /
                    e.currentTarget.getBoundingClientRect().width) *
                    (sections.length - 1),
                ),
              ),
            ),
          };
          draw(e);
        }}
        onPointerMove={draw}
        onPointerUp={(e) => {
          const current = gesture.current;
          if (!current) return;
          gesture.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
          setValues(initial);
          onPropose(
            'Shape the journey',
            shapeJourney(song, current.values, resize),
          );
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setValues(initial);
        }}
      >
        <path
          d={`M 0 100 ${values.map((v, i) => `L ${(i / Math.max(1, values.length - 1)) * 600} ${100 - v * 90}`).join(' ')} L 600 100 Z`}
          fill="#c4f27818"
        />
        <polyline
          points={values
            .map(
              (v, i) =>
                `${(i / Math.max(1, values.length - 1)) * 600},${100 - v * 90}`,
            )
            .join(' ')}
          fill="none"
          stroke="#c4f278"
          strokeWidth="3"
        />
        {values.map((v, i) => (
          <circle
            key={sections[i].id}
            cx={(i / Math.max(1, values.length - 1)) * 600}
            cy={100 - v * 90}
            r="5"
            fill={sections[i].pinned ? '#88919f' : '#c4f278'}
          />
        ))}
      </svg>
      <div className="journey-sliders">
        {sections.map((s, i) => (
          <label key={s.id}>
            {s.name}
            {s.pinned ? ' · kept' : ''}
            <Slider
              aria-label={`${s.name} energy`}
              disabled={s.pinned}
              min={10}
              max={100}
              step={5}
              value={[values[i] * 100]}
              onValueChange={(v) =>
                setValues((current) =>
                  current.map((n, j) =>
                    j === i ? (Array.isArray(v) ? v[0] : v) / 100 : n,
                  ),
                )
              }
              onValueCommitted={(v) => {
                const next = values.map((n, j) =>
                  j === i ? (Array.isArray(v) ? v[0] : v) / 100 : n,
                );
                setValues(initial);
                onPropose(
                  'Shape the journey',
                  shapeJourney(song, next, resize),
                );
              }}
            />
          </label>
        ))}
      </div>
      <div className="direction-buttons">
        <button className="button" onClick={() => preset('rise')}>
          Gentle build
        </button>
        <button className="button" onClick={() => preset('middle')}>
          Big middle
        </button>
        <button className="button" onClick={() => preset('settle')}>
          Quiet ending
        </button>
      </div>
      <label htmlFor="journey-lengths">
        <Switch
          id="journey-lengths"
          checked={resize}
          onCheckedChange={setResize}
        />{' '}
        Also suggest section lengths
      </label>
    </details>
  );
}
