/**
 * Colour (§2.10): the current colour (46 px) with its name and where it came from ("Moon yellow · Recent
 * colour"), the colour picker (I, or hold Alt), 18 kid swatches, 9 skin tones, **From your world** (the
 * colours of this world's other drawings) and **More colours**: a light-and-bright square, a colour
 * slider, a colour code field and the recent colours. Every swatch is a button named by its colour.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { colorId, hexToHsv, hsvToHex, normalizeHex } from '../../draw/colorNames';
import type { ColorOrigin, DeskController, DeskState } from '../../draw/deskController';
import { KID_SWATCHES, SKIN_TONES } from '../../draw/palette';
import { t, type MessageKey } from '../../i18n';
import { Popover } from '../../ui/components';
import { cx } from '../../ui/cx';
import { Icon } from '../../ui/icons';
import { DeskIcon } from './DeskIcons';
import { toolLabel } from './ToolRail';

export function colorName(hex: string): string {
  return t(`draw.color_${colorId(hex)}` as MessageKey);
}

function Swatches({ colors, current, origin, onPick, label }: { colors: readonly string[]; current: string; origin: ColorOrigin; onPick(c: string, o: ColorOrigin): void; label: string }) {
  return (
    <div className="swatches" role="group" aria-label={label}>
      {colors.map((c) => {
        const on = c.toLowerCase() === current.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            className={cx('swatch', on && 'swatch--on')}
            style={{ ['--swatch' as string]: c }}
            aria-label={colorName(c)}
            aria-pressed={on}
            title={colorName(c)}
            onClick={() => onPick(c, origin)}
          />
        );
      })}
    </div>
  );
}

/** More colours: a light-and-bright square, a colour slider, the code and the recent colours. */
function Mixer({ color, recent, onPick }: { color: string; recent: readonly string[]; onPick(c: string, o: ColorOrigin): void }) {
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  const [code, setCode] = useState(color.toUpperCase());
  const square = useRef<HTMLDivElement>(null);

  const apply = (next: { h: number; s: number; v: number }) => {
    setHsv(next);
    const hex = hsvToHex(next.h, next.s, next.v);
    setCode(hex.toUpperCase());
    onPick(hex, 'mixed');
  };

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = square.current?.getBoundingClientRect();
    if (!r) return;
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    apply({ ...hsv, s, v });
  };

  const onSquareKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    apply({ ...hsv, s: Math.min(1, Math.max(0, hsv.s + m[0])), v: Math.min(1, Math.max(0, hsv.v + m[1])) });
  };

  return (
    <div className="mixer">
      <div
        ref={square}
        className="mixer__square"
        style={{ ['--hue' as string]: `hsl(${Math.round(hsv.h)} 100% 50%)` }}
        role="slider"
        tabIndex={0}
        aria-label={t('draw.shade')}
        aria-valuetext={colorName(hsvToHex(hsv.h, hsv.s, hsv.v))}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.v * 100)}
        onKeyDown={onSquareKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
        }}
      >
        <span className="mixer__dot" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} aria-hidden="true" />
      </div>
      <label className="mixer__label">
        <span>{t('draw.hue')}</span>
        <input className="mixer__hue" type="range" min={0} max={359} value={Math.round(hsv.h)} onChange={(e) => apply({ ...hsv, h: Number(e.target.value), s: Math.max(hsv.s, 0.35), v: Math.max(hsv.v, 0.35) })} />
      </label>
      <label className="mixer__label mixer__code">
        <span>{t('draw.hex')}</span>
        <input
          className="field__input"
          value={code}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => {
            setCode(e.target.value);
            const hex = normalizeHex(e.target.value);
            if (hex && e.target.value.replace('#', '').length === 6) {
              setHsv(hexToHsv(hex));
              onPick(hex, 'mixed');
            }
          }}
        />
      </label>
      {recent.length > 1 && <Swatches colors={recent} current={color} origin="recent" onPick={onPick} label={t('draw.origin_recent')} />}
    </div>
  );
}

export function ColorPanel({ ctrl, s, worldColors }: { ctrl: DeskController; s: DeskState; worldColors: readonly string[] }) {
  const [mixing, setMixing] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const pick = (c: string, o: ColorOrigin) => ctrl.setColor(c, o);
  return (
    <section className="side__section colour" aria-labelledby="desk-colour">
      <div className="side__head">
        <h2 id="desk-colour" className="desk-caps">
          {t('draw.colour')}
        </h2>
        <span className="side__meta">{t('draw.brushNow', { tool: toolLabel(s.tool), size: Math.round(s.brush.size) })}</span>
      </div>
      <div className="colour__now">
        <span className="colour__chip" style={{ ['--swatch' as string]: s.color }} aria-hidden="true" />
        <div className="colour__words">
          <strong className="colour__name">{colorName(s.color)}</strong>
          <span className="colour__origin">{t(`draw.origin_${s.origin}`)}</span>
        </div>
        <button
          type="button"
          className={cx('btn btn--icon btn--quiet btn--h44 colour__picker', s.picking && 'colour__picker--on')}
          aria-label={t('draw.pickColour')}
          aria-pressed={s.picking}
          aria-keyshortcuts="I"
          title={t('draw.pickColour')}
          onClick={() => ctrl.setPicking(!s.picking)}
        >
          <DeskIcon name="eyedropper" size={22} />
        </button>
      </div>
      <p className="side__label">{t('draw.colours')}</p>
      <Swatches colors={KID_SWATCHES} current={s.color} origin="box" onPick={pick} label={t('draw.colours')} />
      <p className="side__label">{t('draw.skinTones')}</p>
      <Swatches colors={SKIN_TONES} current={s.color} origin="skin" onPick={pick} label={t('draw.skinTones')} />
      {worldColors.length > 0 && (
        <>
          <p className="side__label">{t('draw.fromWorld')}</p>
          <Swatches colors={worldColors} current={s.color} origin="world" onPick={pick} label={t('draw.fromWorld')} />
        </>
      )}
      <button ref={moreRef} type="button" className="colour__more" aria-expanded={mixing} onClick={() => setMixing((m) => !m)}>
        <span className="colour__rainbow" aria-hidden="true" />
        <span>{t('draw.moreColours')}</span>
        <Icon name="plus" size={16} />
      </button>
      <Popover open={mixing} anchor={moreRef.current} onClose={() => setMixing(false)} label={t('draw.moreColours')} placement="left" className="desk-popover">
        <Mixer color={s.color} recent={s.recent} onPick={pick} />
      </Popover>
    </section>
  );
}
