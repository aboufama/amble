/**
 * The First page's pen dock (§2.3): six marker caps, the size dot (tap cycles 5, 10 and 18 px), the
 * eraser, undo and **More tools** (the full Desk on this drawing). A toolbar with roving focus: arrow
 * keys move between the controls, Enter or Space picks.
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import { t, type MessageKey } from '../../i18n';
import { rovingIndex } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';

/** The six marker caps, in dock order (§2.3). */
export const PENS: ReadonlyArray<{ color: string; label: MessageKey }> = [
  { color: '#221c18', label: 'home.penBlack' },
  { color: '#e8423f', label: 'home.penRed' },
  { color: '#3d7bf2', label: 'home.penBlue' },
  { color: '#ffd23f', label: 'home.penYellow' },
  { color: '#3fbf5a', label: 'home.penGreen' },
  { color: '#8f6cf0', label: 'home.penPurple' },
];

export const PEN_SIZES = [5, 10, 18] as const;
export type PenSize = (typeof PEN_SIZES)[number];
const SIZE_WORDS: Record<PenSize, MessageKey> = { 5: 'home.sizeSmall', 10: 'home.sizeMedium', 18: 'home.sizeBig' };

export interface PenDockProps {
  color: string;
  size: PenSize;
  erasing: boolean;
  canUndo: boolean;
  /** After Bring it to life the pens rest; More tools stays. */
  resting: boolean;
  onColor(color: string): void;
  onSize(size: PenSize): void;
  onEraser(): void;
  onUndo(): void;
  onMoreTools(): void;
}

export function PenDock({ color, size, erasing, canUndo, resting, onColor, onSize, onEraser, onUndo, onMoreTools }: PenDockProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focus, setFocus] = useState(0);
  const count = PENS.length + 4;

  const onKey = (e: KeyboardEvent) => {
    const next = rovingIndex(e.key, focus, count, 'vertical');
    if (next === null) return;
    e.preventDefault();
    setFocus(next);
    refs.current[next]?.focus();
  };

  const bind = (i: number) => ({
    ref: (el: HTMLButtonElement | null) => {
      refs.current[i] = el;
    },
    tabIndex: i === focus ? 0 : -1,
    onFocus: () => setFocus(i),
  });

  const nextSize = PEN_SIZES[(PEN_SIZES.indexOf(size) + 1) % PEN_SIZES.length];

  return (
    <div className={cx('pen-dock', resting && 'pen-dock--resting')} role="toolbar" aria-label={t('home.pens')} aria-orientation="vertical" onKeyDown={onKey} data-testid="pen-dock">
      {PENS.map((p, i) => {
        const on = !erasing && p.color === color;
        return (
          <button
            key={p.color}
            type="button"
            className={cx('pen-dock__cap', on && 'pen-dock__cap--on')}
            aria-label={t(p.label)}
            aria-pressed={on}
            aria-disabled={resting || undefined}
            data-testid={`pen-${i}`}
            onClick={() => !resting && onColor(p.color)}
            {...bind(i)}
          >
            <span className="pen-dock__ink" style={{ background: p.color }} />
          </button>
        );
      })}
      <span className="pen-dock__sep" aria-hidden="true" />
      <button type="button" className="pen-dock__tool" aria-label={t('home.penSize', { size: t(SIZE_WORDS[size]) })} aria-disabled={resting || undefined} onClick={() => !resting && onSize(nextSize)} data-testid="pen-size" {...bind(PENS.length)}>
        <span className="pen-dock__dot" style={{ width: 6 + size * 0.6, height: 6 + size * 0.6, background: erasing ? undefined : color }} />
      </button>
      <button type="button" className={cx('pen-dock__tool', erasing && 'pen-dock__tool--on')} aria-label={t('home.eraser')} aria-pressed={erasing} aria-disabled={resting || undefined} onClick={() => !resting && onEraser()} data-testid="pen-eraser" {...bind(PENS.length + 1)}>
        <Icon name="eraser" size={22} />
      </button>
      <button type="button" className="pen-dock__tool" aria-label={t('home.undo')} aria-disabled={resting || !canUndo || undefined} onClick={() => !resting && canUndo && onUndo()} data-testid="pen-undo" {...bind(PENS.length + 2)}>
        <Icon name="undo" size={22} />
      </button>
      <button type="button" className="pen-dock__more" onClick={onMoreTools} data-testid="more-tools" {...bind(PENS.length + 3)}>
        {t('home.moreTools')}
      </button>
    </div>
  );
}
