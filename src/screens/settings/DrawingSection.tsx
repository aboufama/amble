/**
 * Settings → Drawing (§2.15): Pen pressure (Light / Normal / Firm) with a paper strip to try it on, Left-
 * handed (the Desk's tool rail moves to the right), and Brush sounds.
 */
import { useEffect, useRef, type PointerEvent } from 'react';
import { t } from '../../i18n';
import type { Prefs } from '../../model/types';
import { setPref } from '../../state/prefs';
import { useStore } from '../../state/store';
import { Toggle } from '../../ui/components';
import { Choice, Group } from './parts';

/** How pressure maps to ink: light hands get more ink sooner, firm hands less. */
export const PRESSURE_CURVE: Record<Prefs['pressure'], number> = { light: 0.55, normal: 1, firm: 1.7 };

export function pressureWidth(pressure: number, curve: Prefs['pressure'], min = 1.5, max = 14): number {
  const p = Math.max(0, Math.min(1, pressure));
  return min + (max - min) * p ** PRESSURE_CURVE[curve];
}

function TestLine({ curve }: { curve: Prefs['pressure'] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.strokeStyle = getComputedStyle(c).color;
  }, []);
  const at = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  return (
    <canvas
      ref={canvas}
      className="set-pressure on-paper"
      role="img"
      aria-label={t('school.setPressureTryLabel')}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = at(e);
      }}
      onPointerMove={(e) => {
        const from = last.current;
        const ctx = e.currentTarget.getContext('2d');
        if (!from || !ctx) return;
        const to = at(e);
        const pressure = e.pointerType === 'mouse' ? 0.5 : e.pressure || 0.5;
        ctx.lineWidth = pressureWidth(pressure, curve);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        last.current = to;
      }}
      onPointerUp={() => (last.current = null)}
      onPointerCancel={() => (last.current = null)}
      onDoubleClick={(e) => {
        const c = e.currentTarget;
        c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
      }}
    />
  );
}

export function DrawingSection() {
  const prefs = useStore((s) => s.prefs);
  return (
    <div className="set-drawing">
      <Group>
        <Choice<Prefs['pressure']>
          label={t('school.setPressure')}
          hint={t('school.setPressureHint')}
          options={[
            { value: 'light', label: t('school.setLight') },
            { value: 'normal', label: t('school.setNormal') },
            { value: 'firm', label: t('school.setFirm') },
          ]}
          value={prefs.pressure}
          onChange={(v) => setPref('pressure', v)}
        />
        <TestLine curve={prefs.pressure} />
        <p className="set-row__hint">{t('school.setPressureTry')}</p>
      </Group>
      <Group>
        <Toggle label={t('school.setLeftHanded')} hint={t('school.setLeftHandedHint')} checked={prefs.leftHanded} onChange={(v) => setPref('leftHanded', v)} />
        <Toggle label={t('school.setBrushSounds')} hint={t('school.setBrushSoundsHint')} checked={prefs.brushSounds} onChange={(v) => setPref('brushSounds', v)} />
      </Group>
    </div>
  );
}
