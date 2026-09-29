/**
 * One dial (§2.7): a LIVE dial changes the running game while it moves; a RESTARTS dial changes it when
 * the student lets go (the level restarts once, not at every step). Each resets on focus (↺).
 */
import { useEffect, useState } from 'react';
import type { DialInfo } from '../../cores/play';
import { formatDial, resetDial, setDial } from '../../state/session';
import { Slider } from '../../ui/components';

export function DialSlider({ dial, className }: { dial: DialInfo; className?: string }) {
  const [moving, setMoving] = useState<number | null>(null);
  useEffect(() => setMoving(null), [dial.current]);
  const value = moving ?? dial.current;
  return (
    <Slider
      className={className}
      label={dial.label}
      value={value}
      min={dial.min}
      max={dial.max}
      step={dial.step}
      unit={dial.unit}
      format={(v) => `${formatDial(v)}${dial.unit ?? ''}`}
      badge={dial.live ? 'live' : 'restarts'}
      onChange={(v) => {
        if (dial.live) setDial(dial.key, v);
        else setMoving(v);
      }}
      onCommit={(v) => {
        if (!dial.live && v !== dial.current) setDial(dial.key, v);
      }}
      onReset={dial.current !== dial.value ? () => resetDial(dial.key) : undefined}
    />
  );
}
