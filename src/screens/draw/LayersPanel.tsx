/**
 * Layers (§2.10, §7.3). Freehand: a listbox of the layers, top first, each with a thumbnail, its name, what
 * it is for ("Ink on top", "Fill paints here", "Hidden · never in the game") and an eye; **+ New** adds
 * Shading or a plain layer; ⋯ holds the rest for the selected layer (show, move up or down, copy, join,
 * lock, rename, delete; all undoable). On the bones: **Parts**, one row per step with **drawing now** or
 * **✓ done**, and any other layers below. Then the Flipbook row.
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { LayerInfo } from '../../cores/art';
import type { DeskController, DeskState } from '../../draw/deskController';
import { t } from '../../i18n';
import { rovingIndex } from '../../ui/a11y';
import { Menu } from '../../ui/components';
import { cx } from '../../ui/cx';
import { Icon } from '../../ui/icons';
import { stepLabel } from './GuideStrip';
import { LayerOptions } from './LayerOptions';
import { useLayerThumbs } from './useDesk';

const DEFAULT_NAMES = new Set(['lines', 'colours', 'colors', 'sketch', 'layer', 'shading', 'trace', 'photo to trace', 'photo lines', 'paint']);

type LayerKind = 'lines' | 'colors' | 'sketch' | 'trace' | 'shading' | 'paint' | 'photoLines';

function kindOf(l: LayerInfo): LayerKind {
  if (l.role === 'lines') return /photo/i.test(l.name) ? 'photoLines' : 'lines';
  if (l.role === 'colors') return 'colors';
  if (l.role === 'sketch') return 'sketch';
  if (l.role === 'trace') return 'trace';
  if (l.role === 'paint' && l.blend === 'multiply') return 'shading';
  return 'paint';
}

export function layerName(l: LayerInfo): string {
  if (!DEFAULT_NAMES.has(l.name.trim().toLowerCase())) return l.name;
  return t(`draw.layer_${kindOf(l)}`);
}

function layerHint(l: LayerInfo): string {
  const k = kindOf(l);
  if (k === 'sketch' && !l.visible) return t('draw.hint_sketchHidden');
  return t(`draw.hint_${k}`);
}

function Thumb({ bitmap }: { bitmap: ImageBitmap | undefined }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!bitmap) return;
    const k = Math.min(c.width / bitmap.width, c.height / bitmap.height);
    const w = bitmap.width * k;
    const h = bitmap.height * k;
    try {
      ctx.drawImage(bitmap, (c.width - w) / 2, (c.height - h) / 2, w, h);
    } catch {
      // A closed bitmap draws nothing; the next one replaces it.
    }
  }, [bitmap]);
  return <canvas ref={ref} className="layer__thumb" width={88} height={88} aria-hidden="true" />;
}

interface Row {
  id: string;
  name: string;
  hint: string;
  visible: boolean;
  locked: boolean;
  /** Layers the eye shows or hides. */
  ids: string[];
  thumb: string;
  status?: 'now' | 'done' | 'empty';
  select(): void;
}

export function LayersPanel({ ctrl, s }: { ctrl: DeskController; s: DeskState }) {
  const bones = s.mode === 'bones';
  const partIds = new Set(Object.values(s.parts).flatMap((p) => [p.lines, p.colors]));
  const top = [...s.layers].reverse();
  const thumbs = useLayerThumbs(
    ctrl,
    s.layers.map((l) => l.id),
  );

  const rows: Row[] = [];
  if (bones) {
    // The steps drawn so far and the one being drawn, the newest on top (like the parts' layers).
    const empty = new Set(s.layers.filter((l) => l.empty).map((l) => l.id));
    s.steps.forEach((st, i) => {
      if (!st.parts.length) return;
      const ids = st.parts.flatMap((p) => (s.parts[p] ? [s.parts[p].colors, s.parts[p].lines] : []));
      const layers = s.layers.filter((l) => ids.includes(l.id));
      const drawn = st.parts.some((p) => s.drawn.includes(p));
      const on = i === s.step;
      if (!on && !drawn) return;
      const first = s.parts[st.parts.find((p) => s.drawn.includes(p)) ?? st.parts[0]];
      rows.push({
        id: `step:${st.step}`,
        name: stepLabel(st.step),
        hint: '',
        visible: layers.some((l) => l.visible),
        locked: false,
        ids,
        thumb: first ? (empty.has(first.colors) ? first.lines : first.colors) : '',
        status: on ? 'now' : 'done',
        select: () => ctrl.setStep(i),
      });
    });
    rows.reverse();
  }
  for (const l of top) {
    if (bones && partIds.has(l.id)) continue;
    rows.push({ id: l.id, name: layerName(l), hint: layerHint(l), visible: l.visible, locked: l.locked, ids: [l.id], thumb: l.id, select: () => ctrl.selectLayer(l.id) });
  }

  const selected = bones ? rows.findIndex((r) => r.status === 'now') : rows.findIndex((r) => r.id === s.active);
  const current = rows[selected] ?? null;
  const activeLayer = s.layers.find((l) => l.id === s.active) ?? null;
  const listRef = useRef<HTMLUListElement>(null);

  const onKey = (e: KeyboardEvent) => {
    const next = rovingIndex(e.key, Math.max(0, selected), rows.length, 'vertical', false);
    if (next === null) return;
    e.preventDefault();
    rows[next].select();
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  };

  const toggle = (r: Row) => {
    for (const id of r.ids) ctrl.setLayerVisible(id, !r.visible);
  };

  return (
    <section className="side__section layers" aria-labelledby="desk-layers">
      <div className="side__head">
        <h2 id="desk-layers" className="desk-caps">
          {bones ? t('draw.parts') : t('draw.layers')}
        </h2>
        <div className="side__actions">
          <Menu
            label={t('draw.newLayer')}
            icon="plus"
            showLabel
            size={38}
            items={[
              { id: 'shading', label: t('draw.newShading'), onSelect: () => ctrl.addLayer('shading') },
              { id: 'plain', label: t('draw.newPlain'), onSelect: () => ctrl.addLayer('plain') },
            ]}
          />
          {activeLayer && (
            <LayerOptions
              ctrl={ctrl}
              layer={activeLayer}
              name={layerName(activeLayer)}
              first={s.layers[0]?.id === activeLayer.id}
              last={s.layers[s.layers.length - 1]?.id === activeLayer.id}
              count={s.layers.length}
            />
          )}
        </div>
      </div>
      {bones && <p className="layers__hint">{t('draw.partsHint')}</p>}
      <ul ref={listRef} className="layers__list" role="listbox" aria-label={bones ? t('draw.parts') : t('draw.layers')} onKeyDown={onKey}>
        {rows.map((r, i) => {
          const on = i === selected;
          const statusText = r.status === 'now' ? t('draw.drawingNow') : r.status === 'done' ? t('draw.partDone') : r.status === 'empty' ? t('draw.partEmpty') : r.hint;
          return (
            <li
              key={r.id}
              role="option"
              aria-selected={on}
              tabIndex={on || (selected < 0 && i === 0) ? 0 : -1}
              className={cx('layer', on && 'layer--on', !r.visible && 'layer--hidden')}
              onClick={() => r.select()}
              aria-label={`${r.name}, ${statusText}${r.visible ? '' : `, ${t('draw.hiddenWord')}`}`}
            >
              <Thumb bitmap={thumbs.get(r.thumb)} />
              <span className="layer__words">
                <span className="layer__name">
                  {r.name}
                  {r.locked && <Icon name="lock" size={14} />}
                </span>
                {r.status ? (
                  <span className={cx('layer__status', `layer__status--${r.status}`)}>
                    {r.status === 'done' && <Icon name="check" size={14} />}
                    {statusText}
                  </span>
                ) : (
                  <span className="layer__hint">{r.hint}</span>
                )}
              </span>
              <button
                type="button"
                tabIndex={-1}
                className="layer__eye"
                aria-hidden="true"
                title={r.visible ? t('draw.hideLayer', { layer: r.name }) : t('draw.showLayer', { layer: r.name })}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(r);
                }}
              >
                <Icon name={r.visible ? 'eye' : 'eyeOff'} size={20} />
              </button>
            </li>
          );
        })}
      </ul>
      {current && !current.visible && <p className="sr-only">{t('draw.layerHidden')}</p>}
    </section>
  );
}
