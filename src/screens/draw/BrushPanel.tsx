/**
 * Brush (§2.10): **Size** (on a gentle curve, so small sizes are easy to hit), **Opacity**, and **Steady**
 * while Steady is on. Native range inputs (taps, arrow keys, typed numbers).
 */
import type { DeskController, DeskState } from '../../draw/deskController';
import { t } from '../../i18n';
import { Slider } from '../../ui/components';

const MAX_SIZE = 160;

/** Slider position (0..100) ↔ brush size (px): a square curve. */
export function sizeFromSlider(v: number, pixel: boolean): number {
  if (pixel) return Math.max(1, Math.min(4, Math.round(v)));
  return Math.max(1, Math.round((1 + (v / 100) ** 2 * (MAX_SIZE - 1)) * 10) / 10);
}

export function sliderFromSize(size: number, pixel: boolean): number {
  if (pixel) return Math.max(1, Math.min(4, Math.round(size)));
  return Math.round(Math.sqrt(Math.max(0, Math.min(1, (size - 1) / (MAX_SIZE - 1)))) * 100);
}

export function BrushPanel({ ctrl, s, pixel }: { ctrl: DeskController; s: DeskState; pixel: boolean }) {
  const size = s.brush.size;
  return (
    <section className="side__section brush" aria-labelledby="desk-brush">
      <h2 id="desk-brush" className="desk-caps">
        {t('draw.brush')}
      </h2>
      <Slider
        className="brush__slider"
        label={t('draw.size')}
        min={pixel ? 1 : 0}
        max={pixel ? 4 : 100}
        value={sliderFromSize(size, pixel)}
        format={() => String(Math.round(size))}
        onChange={(v) => ctrl.setSize(sizeFromSlider(v, pixel))}
      />
      <Slider
        className="brush__slider"
        label={t('draw.opacity')}
        min={5}
        max={100}
        value={Math.round(s.brush.opacity * 100)}
        format={(v) => t('draw.opacityValue', { n: v })}
        onChange={(v) => ctrl.setOpacity(v / 100)}
      />
      {s.steady && (
        <Slider
          className="brush__slider"
          label={t('draw.steadySlider')}
          min={0}
          max={100}
          value={Math.round((s.brush.steady ?? 0) * 100)}
          format={(v) => String(Math.round(v / 10))}
          onChange={(v) => ctrl.setSteadyAmount(v / 100)}
        />
      )}
    </section>
  );
}
