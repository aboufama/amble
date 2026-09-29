/**
 * The dial (§3.4, §2.7): a native range input with its label and value (JetBrains Mono), a LIVE or
 * RESTARTS badge, a reset on focus, and a number field on Enter. Tap the track, drag, arrows,
 * PgUp/PgDn, Home/End all work (the native input), so no dragging is required (WCAG 2.5.7).
 */
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../../i18n';
import { Icon } from '../icons';
import { cx } from '../cx';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Every change while dragging or pressing keys. */
  onChange(value: number): void;
  /** When the student lets go (pointer up, key up, or a typed number). */
  onCommit?(value: number): void;
  badge?: 'live' | 'restarts' | null;
  format?(value: number): string;
  /** Shows a reset button (↺) while the dial has focus. */
  onReset?(): void;
  unit?: string;
  className?: string;
}

function clampStep(v: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, v));
  if (!step) return clamped;
  const n = Math.round((clamped - min) / step);
  return Math.min(max, Math.max(min, +(min + n * step).toFixed(6)));
}

export function Slider({ label, value, min, max, step = 1, onChange, onCommit, badge, format, onReset, unit, className }: SliderProps) {
  const id = useId();
  const [typing, setTyping] = useState<string | null>(null);
  const range = useRef<HTMLInputElement>(null);
  const shown = format ? format(value) : `${value}${unit ?? ''}`;

  const commitTyped = () => {
    if (typing === null) return;
    const n = Number(typing);
    setTyping(null);
    if (Number.isFinite(n)) {
      const v = clampStep(n, min, max, step);
      onChange(v);
      onCommit?.(v);
    }
    requestAnimationFrame(() => range.current?.focus());
  };

  const onRangeKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setTyping(String(value));
    }
  };

  return (
    <div className={cx('slider', className)}>
      <div className="slider__head">
        <label htmlFor={id} className="slider__label">
          {label}
        </label>
        {badge && <span className={cx('slider__badge', `slider__badge--${badge}`)}>{badge === 'live' ? t('common.sliderLive') : t('common.sliderRestarts')}</span>}
        {typing === null ? (
          <output htmlFor={id} className="slider__value">
            {shown}
          </output>
        ) : (
          <input
            className="slider__number"
            type="number"
            inputMode="decimal"
            aria-label={t('common.sliderType', { label })}
            value={typing}
            min={min}
            max={max}
            step={step}
            autoFocus
            onChange={(e) => setTyping(e.target.value)}
            onBlur={commitTyped}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTyped();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setTyping(null);
                range.current?.focus();
              }
            }}
          />
        )}
        {onReset && (
          <button type="button" className="slider__reset" aria-label={t('common.sliderReset', { label })} onClick={onReset}>
            <Icon name="restart" size={16} />
          </button>
        )}
      </div>
      <input
        ref={range}
        id={id}
        className="slider__range"
        type="range"
        min={min}
        max={max}
        step={step || 'any'}
        value={value}
        aria-valuetext={t('common.sliderValue', { label, value: shown })}
        style={{ ['--fill' as string]: `${((value - min) / (max - min || 1)) * 100}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyDown={onRangeKey}
      />
    </div>
  );
}
