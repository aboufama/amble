/**
 * The tool rail (§2.10): Ink, Pencil, Marker, Crayon, Airbrush, Eraser, Fill, then Select, Shapes and
 * Trace; square tiles with an icon and a word, the chosen tool marked the way Scratch marks a chosen
 * sprite (a purple edge and halo). A vertical toolbar: arrow keys move between tools, Enter or Space
 * picks one. On pixel boards the Pixel pen takes the brushes' place. In the touch layout a ⋯ button
 * beside the active tool opens its options.
 *
 * When the window is too short for every tile (a Chromebook browser tab with big text), the last tools
 * move into **More tools** at the foot of the rail, so no tool is ever cut off out of sight.
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { KEY_OF, type DeskTool } from '../../draw/deskController';
import { t, type MessageKey } from '../../i18n';
import { rovingIndex } from '../../ui/a11y';
import { Popover } from '../../ui/components';
import { cx } from '../../ui/cx';
import { Icon, type IconName } from '../../ui/icons';

export type RailItem = DeskTool | 'trace';

const BRUSHES: RailItem[] = ['ink', 'pencil', 'marker', 'crayon', 'airbrush', 'eraser', 'fill'];
const PIXEL: RailItem[] = ['pixel', 'eraser', 'fill'];
const MORE: RailItem[] = ['select', 'shapes', 'trace'];

const ICON: Record<RailItem, IconName> = {
  ink: 'ink',
  pencil: 'pencil',
  marker: 'marker',
  crayon: 'crayon',
  airbrush: 'airbrush',
  eraser: 'eraser',
  fill: 'fill',
  select: 'lasso',
  shapes: 'shapes',
  trace: 'trace',
  pixel: 'draw',
};

export function toolLabel(tool: RailItem): string {
  return t(`draw.tool_${tool}` as MessageKey);
}

export interface ToolRailProps {
  tool: DeskTool;
  pixelArt: boolean;
  onTool(tool: DeskTool): void;
  onTrace(): void;
  /** The touch layout: the options of the active tool, in a popover beside it. */
  options?: ReactNode;
  disabled?: boolean;
}

const px = (v: string): number => Number.parseFloat(v) || 0;

/**
 * How many tiles fit the rail's room (all of them, or some plus **More tools**), measured from the tiles
 * themselves, so bigger text or a shorter window still shows every tool or says there are more.
 */
function useTilesThatFit(rail: RefObject<HTMLDivElement | null>, total: number): number {
  const [shown, setShown] = useState(total);
  useLayoutEffect(() => {
    const el = rail.current;
    const room = el?.parentElement;
    if (!el || !room) return;
    const measure = () => {
      const tile = el.querySelector<HTMLElement>('.rail__slot');
      if (!tile) return;
      const rs = getComputedStyle(room);
      const cs = getComputedStyle(el);
      const avail = room.clientHeight - px(rs.paddingTop) - px(rs.paddingBottom);
      const frame = px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
      const gap = px(cs.rowGap);
      const hr = el.querySelector<HTMLElement>('.rail__divider');
      const divider = hr ? hr.offsetHeight + px(getComputedStyle(hr).marginTop) + px(getComputedStyle(hr).marginBottom) + gap : 0;
      const tileH = tile.offsetHeight;
      const need = (tiles: number) => frame + tiles * tileH + Math.max(0, tiles - 1) * gap + divider;
      let n = total;
      if (need(total) > avail + 0.5) {
        n = total - 1;
        while (n > 1 && need(n + 1) > avail + 0.5) n--;
      }
      setShown(n);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(room);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rail, total]);
  return Math.min(shown, total);
}

export function ToolRail({ tool, pixelArt, onTool, onTrace, options, disabled }: ToolRailProps) {
  const brushes = pixelArt ? PIXEL : BRUSHES;
  const items = [...brushes, ...MORE];
  const railRef = useRef<HTMLDivElement>(null);
  const shown = useTilesThatFit(railRef, items.length);
  const visible = items.slice(0, shown);
  const hidden = items.slice(shown);
  // The tab stops: every visible tile, then More tools when some tools are in it.
  const stops = visible.length + (hidden.length ? 1 : 0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focus, setFocus] = useState(() => Math.max(0, items.indexOf(tool)));
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const optionsRef = useRef<HTMLButtonElement>(null);
  const active = items.indexOf(tool);
  const hiddenOn = hidden.includes(tool);
  const tabStop = focus >= 0 && focus < stops ? focus : Math.max(0, Math.min(active, stops - 1));

  const pick = (item: RailItem) => {
    if (item === 'trace') onTrace();
    else onTool(item);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // Only the rail's own tiles: keys in its popovers (portalled, but their events bubble here) are theirs.
    if (!e.currentTarget.contains(e.target as Node)) return;
    const next = rovingIndex(e.key, tabStop, stops, 'vertical');
    if (next === null) return;
    e.preventDefault();
    setFocus(next);
    refs.current[next]?.focus();
  };

  const tile = (item: RailItem, i: number) => {
    const on = item === tool;
    const key = item !== 'trace' ? KEY_OF[item] : undefined;
    const label = toolLabel(item);
    return (
      <div key={item} className={cx('rail__slot', on && 'rail__slot--on')}>
        <button
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          className={cx('rail__tool', on && 'rail__tool--on')}
          aria-pressed={item === 'trace' ? undefined : on}
          aria-keyshortcuts={key}
          title={key ? t('draw.toolKey', { tool: label, key }) : label}
          tabIndex={i === tabStop ? 0 : -1}
          disabled={disabled}
          onClick={() => {
            setFocus(i);
            pick(item);
          }}
          data-tool={item}
        >
          <Icon name={ICON[item]} size={24} />
          <span className="rail__label">{label}</span>
        </button>
        {on && optionsButton}
      </div>
    );
  };

  // The touch layout's ⋯ beside the chosen tool (or beside More tools, when the chosen tool is in there).
  const optionsButton = options && (
    <button
      ref={optionsRef}
      type="button"
      className="rail__more"
      aria-label={t('draw.toolOptions', { tool: toolLabel(tool) })}
      aria-expanded={optionsOpen}
      onClick={() => setOptionsOpen((o) => !o)}
    >
      <Icon name="more" size={18} />
    </button>
  );

  const moreLabel = hiddenOn ? t('draw.moreToolsOn', { tool: toolLabel(tool) }) : t('draw.moreTools');
  const moreTile = hidden.length > 0 && (
    <div className={cx('rail__slot', hiddenOn && 'rail__slot--on')}>
      <button
        ref={(el) => {
          refs.current[visible.length] = el;
        }}
        type="button"
        className={cx('rail__tool', 'rail__tool--more', hiddenOn && 'rail__tool--on')}
        aria-label={moreLabel}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        title={moreLabel}
        tabIndex={visible.length === tabStop ? 0 : -1}
        disabled={disabled}
        data-testid="rail-more"
        onClick={() => {
          setFocus(visible.length);
          setMoreOpen((o) => !o);
        }}
      >
        <Icon name={hiddenOn ? ICON[tool] : 'more'} size={24} />
        <span className="rail__label">{hiddenOn ? toolLabel(tool) : t('draw.moreShort')}</span>
        <span className="rail__flyout" aria-hidden="true" />
      </button>
      {hiddenOn && optionsButton}
    </div>
  );

  return (
    <div ref={railRef} className="rail" role="toolbar" aria-orientation="vertical" aria-label={t('draw.toolsLabel')} onKeyDown={onKey}>
      {visible.slice(0, brushes.length).map((item, i) => tile(item, i))}
      <hr className="rail__divider" aria-hidden="true" />
      {visible.slice(brushes.length).map((item, i) => tile(item, brushes.length + i))}
      {moreTile}
      {hidden.length > 0 && (
        <Popover open={moreOpen} anchor={refs.current[visible.length] ?? null} onClose={() => setMoreOpen(false)} label={t('draw.moreTools')} placement="right" className="desk-popover rail-more">
          <div className="rail-more__list" role="group" aria-label={t('draw.moreTools')}>
            {hidden.map((item) => {
              const on = item === tool;
              const key = item !== 'trace' ? KEY_OF[item] : undefined;
              const label = toolLabel(item);
              return (
                <button
                  key={item}
                  type="button"
                  className={cx('rail-more__tool', on && 'rail-more__tool--on')}
                  aria-pressed={item === 'trace' ? undefined : on}
                  aria-keyshortcuts={key}
                  data-tool={item}
                  onClick={() => {
                    setMoreOpen(false);
                    pick(item);
                  }}
                >
                  <Icon name={ICON[item]} size={22} />
                  <span>{label}</span>
                  {key && <kbd className="rail-more__key">{key}</kbd>}
                </button>
              );
            })}
          </div>
        </Popover>
      )}
      {options && (
        <Popover open={optionsOpen} anchor={optionsRef.current} onClose={() => setOptionsOpen(false)} label={t('draw.toolOptions', { tool: toolLabel(tool) })} placement="right" className="desk-popover">
          {options}
        </Popover>
      )}
    </div>
  );
}
