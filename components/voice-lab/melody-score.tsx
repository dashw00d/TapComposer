import { useEffect, useRef } from 'react';
import { noteName, type ReferenceNote } from '@/lib/voice-lab/protocol';
const diatonic = (pitch: number) =>
  Math.floor(pitch / 12) * 7 + [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][pitch % 12];
export function MelodyScore({
  notes,
  duration,
  beat,
  position,
  active,
}: {
  notes: ReferenceNote[];
  duration: number;
  beat: number;
  position: number;
  active: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scroller.current;
    if (active && element)
      element.scrollLeft = Math.max(
        0,
        ((70 + (position / duration) * 740) / 850) * element.scrollWidth -
          element.clientWidth / 2,
      );
  }, [position, duration, active]);
  const treble = notes[0].pitch >= 57;
  const bottom = diatonic(treble ? 64 : 43);
  const width = 850;
  const x = (time: number) => 70 + (time / duration) * 740;
  return (
    <div className="lab-score-scroll" ref={scroller}>
      <svg
        className="lab-score"
        viewBox={`0 0 ${width} 195`}
        // SVG is a scalable score; an img element cannot contain its note geometry.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="img"
        aria-label={`Reference score: ${notes.map((n) => `${noteName(n.pitch)} for ${Math.round(((n.duration + 0.08) / beat) * 2) / 2} beats`).join(', ')}`}
      >
        {[40, 50, 60, 70, 80].map((y) => (
          <line
            key={y}
            x1={20}
            x2={830}
            y1={y}
            y2={y}
            stroke="#788b9f"
            strokeWidth=".8"
          />
        ))}
        <text x={24} y={78} fontSize={50} fill="#c7d5e4" fontFamily="serif">
          {treble ? '𝄞' : '𝄢'}
        </text>
        {Array.from(
          { length: Math.ceil((duration - 2) / beat) },
          (_, index) => (
            <g key={index}>
              <line
                x1={x(1 + index * beat)}
                x2={x(1 + index * beat)}
                y1={25}
                y2={140}
                stroke="#8293a3"
                strokeOpacity={index % 4 ? 0.1 : 0.35}
              />
              <text
                x={x(1 + index * beat)}
                y={178}
                textAnchor="middle"
                fill="#a4b6ca"
                fontSize={12}
              >
                {index + 1}
              </text>
            </g>
          ),
        )}
        {notes.map((note, index) => {
          const y = 80 - (diatonic(note.pitch) - bottom) * 5;
          const at = x(note.time);
          const beats = Math.round(((note.duration + 0.08) / beat) * 2) / 2;
          const current =
            active &&
            position >= note.time &&
            position < note.time + note.duration;
          const color = current ? '#d6f68a' : '#c7bdf5';
          const ledgers =
            y < 40
              ? Array.from(
                  { length: Math.floor((40 - y) / 10) },
                  (_, i) => 30 - i * 10,
                )
              : y > 80
                ? Array.from(
                    { length: Math.floor((y - 80) / 10) },
                    (_, i) => 90 + i * 10,
                  )
                : [];
          return (
            <g key={index}>
              {current && (
                <rect
                  x={at - 12}
                  y={8}
                  width={Math.max(24, x(note.time + note.duration) - at + 15)}
                  height={150}
                  rx={7}
                  fill="#d6f68a"
                  opacity={0.08}
                />
              )}
              {ledgers.map((ledger) => (
                <line
                  key={ledger}
                  x1={at - 12}
                  x2={at + 12}
                  y1={ledger}
                  y2={ledger}
                  stroke="#8f9eac"
                />
              ))}
              <ellipse
                cx={at}
                cy={y}
                rx={7}
                ry={5}
                fill={beats >= 2 ? '#19212b' : color}
                stroke={color}
                strokeWidth={2}
                transform={`rotate(-18 ${at} ${y})`}
              />
              {beats < 4 && (
                <line
                  x1={at + 6}
                  x2={at + 6}
                  y1={y}
                  y2={y - 27}
                  stroke={color}
                  strokeWidth={2}
                />
              )}
              {beats < 1 && (
                <path
                  d={`M ${at + 6} ${y - 27} q 15 5 8 16`}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                />
              )}
              {noteName(note.pitch).includes('♯') && (
                <text x={at - 19} y={y + 5} fill={color} fontSize={17}>
                  ♯
                </text>
              )}
              <rect
                x={at}
                y={115}
                width={Math.max(8, x(note.time + note.duration) - at)}
                height={8}
                rx={4}
                fill={color}
                opacity={current ? 1 : 0.5}
              />
              <text
                x={at}
                y={145}
                fill={color}
                fontSize={13}
                textAnchor="middle"
              >
                {noteName(note.pitch)}
              </text>
              <text
                x={at}
                y={160}
                fill="#9badc1"
                fontSize={10}
                textAnchor="middle"
              >
                {beats} {beats === 1 ? 'beat' : 'beats'}
              </text>
              {index < notes.length - 1 &&
                notes[index + 1].time - note.time - note.duration > 0.2 && (
                  <text
                    x={x(note.time + note.duration + 0.15)}
                    y={108}
                    fill="#a4b6ca"
                    fontSize={11}
                  >
                    rest
                  </text>
                )}
            </g>
          );
        })}
        {active && (
          <line
            x1={x(Math.max(0, position))}
            x2={x(Math.max(0, position))}
            y1={10}
            y2={184}
            stroke="#d6f68a"
            strokeWidth={2}
          />
        )}
      </svg>
    </div>
  );
}
