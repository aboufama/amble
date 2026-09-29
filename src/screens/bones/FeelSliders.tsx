/**
 * Feel (§2.11, §7.12): **Bouncy** (calm ↔ boing: how big the move is) and **Speedy** (slow ↔ zoom: how
 * fast), for the move that is playing. Native range inputs (tap, drag, arrows, Home/End), with the
 * middle of each track at normal, and the value in words.
 */
import { useId } from 'react';
import { t, type MessageKey } from '../../i18n';

/** Slider position (0..100) ↔ multiplier: the middle is 1, the ends are the move's limits (§7.12). */
export const FEEL = {
  amount: { min: 0.3, max: 2 },
  speed: { min: 0.5, max: 2 },
} as const;

export function feelFromPos(which: keyof typeof FEEL, pos: number): number {
  const { min, max } = FEEL[which];
  const p = Math.max(0, Math.min(100, pos));
  const v = p <= 50 ? min + (p / 50) * (1 - min) : 1 + ((p - 50) / 50) * (max - 1);
  return Math.round(v * 100) / 100;
}

export function posFromFeel(which: keyof typeof FEEL, value: number): number {
  const { min, max } = FEEL[which];
  const v = Math.max(min, Math.min(max, value));
  return Math.round(v <= 1 ? ((v - min) / (1 - min)) * 50 : 50 + ((v - 1) / (max - 1)) * 50);
}

function word(which: keyof typeof FEEL, v: number): string {
  let key: MessageKey;
  if (which === 'amount') key = v < 0.55 ? 'bones.feelCalm' : v < 0.92 ? 'bones.feelLittle' : v <= 1.08 ? 'bones.feelNormal' : v < 1.6 ? 'bones.feelLot' : 'bones.feelBoing';
  else key = v < 0.7 ? 'bones.feelSlow' : v < 0.92 ? 'bones.feelBitSlow' : v <= 1.08 ? 'bones.feelNormal' : v < 1.6 ? 'bones.feelFast' : 'bones.feelZoom';
  return t(key);
}

export interface FeelSlidersProps {
  moveName: string;
  amount: number;
  speed: number;
  onChange(which: keyof typeof FEEL, value: number): void;
  disabled?: boolean;
}

function FeelRow({ which, label, low, high, value, onChange, disabled }: { which: keyof typeof FEEL; label: string; low: string; high: string; value: number; onChange(v: number): void; disabled?: boolean }) {
  const id = useId();
  const pos = posFromFeel(which, value);
  const w = word(which, value);
  return (
    <div className="feel-row">
      <label htmlFor={id} className="feel-row__label">
        {label}
      </label>
      <div className="feel-row__track">
        <input
          id={id}
          className="feel-row__range"
          type="range"
          min={0}
          max={100}
          step={1}
          value={pos}
          disabled={disabled}
          aria-valuetext={t('bones.feelValue', { word: w, value: value.toFixed(1) })}
          style={{ ['--fill' as string]: `${pos}%` }}
          onChange={(e) => onChange(feelFromPos(which, Number(e.target.value)))}
        />
        <span className="feel-row__ends" aria-hidden="true">
          <span>{low}</span>
          <span>{high}</span>
        </span>
      </div>
      <output htmlFor={id} className="feel-row__value">
        {w}
      </output>
    </div>
  );
}

export function FeelSliders({ moveName, amount, speed, onChange, disabled }: FeelSlidersProps) {
  return (
    <section className="bones-side__section feel" aria-labelledby="bones-feel-title">
      <div className="bones-side__head">
        <h2 id="bones-feel-title" className="bones-side__title">
          {t('bones.feelTitle')}
        </h2>
        <span className="bones-side__sub">{t('bones.feelFor', { move: moveName })}</span>
      </div>
      <FeelRow which="amount" label={t('bones.bouncy')} low={t('bones.bouncyLow')} high={t('bones.bouncyHigh')} value={amount} onChange={(v) => onChange('amount', v)} disabled={disabled} />
      <FeelRow which="speed" label={t('bones.speedy')} low={t('bones.speedyLow')} high={t('bones.speedyHigh')} value={speed} onChange={(v) => onChange('speed', v)} disabled={disabled} />
    </section>
  );
}
