/**
 * The tool rail (§2.10): Ink, Pencil, Marker, Crayon, Airbrush, Eraser, Fill, then Select, Shapes and
 * Trace; 62 px tiles with an icon and a word, the active tool a cream tile with a lantern ring. A vertical
 * toolbar: arrow keys move between tools, Enter or Space picks one. On pixel boards the Pixel pen takes
 * the brushes' place. In the touch layout a ⋯ button beside the active tool opens its options.
 */
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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

export function ToolRail({ tool, pixelArt, onTool, onTrace, options, disabled }: ToolRailProps) {
  const items = [...(pixelArt ? PIXEL : BRUSHES), ...MORE];
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focus, setFocus] = useState(() => Math.max(0, items.indexOf(tool)));
  const [optionsOpen, setOptionsOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const active = items.indexOf(tool);
  const tabStop = focus >= 0 && focus < items.length ? focus : Math.max(0, active);

  const pick = (item: RailItem) => {
    if (item === 'trace') onTrace();
    else onTool(item);
  };

  const onKey = (e: KeyboardEvent) => {
    const next = rovingIndex(e.key, tabStop, items.length, 'vertical');
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
        {on && options && (
          <button
            ref={moreRef}
            type="button"
            className="rail__more"
            aria-label={t('draw.toolOptions', { tool: label })}
            aria-expanded={optionsOpen}
            onClick={() => setOptionsOpen((o) => !o)}
          >
            <Icon name="more" size={18} />
          </button>
        )}
      </div>
    );
  };

  const brushes = pixelArt ? PIXEL : BRUSHES;
  return (
    <div className="rail" role="toolbar" aria-orientation="vertical" aria-label={t('draw.toolsLabel')} onKeyDown={onKey}>
      {brushes.map((item, i) => tile(item, i))}
      <hr className="rail__divider" aria-hidden="true" />
      {MORE.map((item, i) => tile(item, brushes.length + i))}
      {options && (
        <Popover open={optionsOpen} anchor={moreRef.current} onClose={() => setOptionsOpen(false)} label={t('draw.toolOptions', { tool: toolLabel(tool) })} placement="right" className="desk-popover">
          {options}
        </Popover>
      )}
    </div>
  );
}
