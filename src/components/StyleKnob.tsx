import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { presetOf, STYLE_PRESETS } from '../project/styles';
import { projectStyle } from '../project/controls';
import { setStyle } from '../actions';
import { useStore } from '../store';
import { BrushIcon, CaretDownIcon } from './icons';

interface StyleKnobProps {
  /** The art style's words: a preset's, the author's own, or '' for none. */
  value: string;
  onChange(words: string): void;
  /** 'bar' for the top bar (white on purple), 'page' for the home screen. */
  look?: 'bar' | 'page';
}

/** Room the list wants under (or over) the knob, and its width. */
const LIST_HEIGHT = 330;
const LIST_WIDTH = 296;

/**
 * The style knob: picks the game's art style from a few presets, the author's own words
 * ("Custom…", e.g. "pixel art"), or none. What it gives is the words of the `art style:` block.
 */
export function StyleKnob({ value, onChange, look = 'bar' }: StyleKnobProps) {
  const [open, setOpen] = useState(false);
  /** The author's own words being typed (null while that field is closed). */
  const [custom, setCustom] = useState<string | null>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const preset = presetOf(value);
  const own = Boolean(value) && !preset;

  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) knob.current?.focus();
  };

  const toggle = () => {
    if (open) return close();
    // The list hangs under the knob, or over it when there is more room there. It is placed on the
    // window (not in the page), so the home screen's scrolling box doesn't cut it off.
    const r = knob.current!.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 14;
    const above = r.top - 14;
    const up = below < LIST_HEIGHT && above > below;
    setPlace({
      left: Math.max(8, Math.min(r.left, window.innerWidth - LIST_WIDTH - 8)),
      ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      maxHeight: Math.max(120, up ? above : below),
    });
    setCustom(own ? value : null);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    // Starts on the style it has (its own words: in their field, ready to change).
    const first = list.current?.querySelector<HTMLElement>('input, [aria-checked="true"]') ?? list.current?.querySelector<HTMLElement>('[role="menuitemradio"]');
    first?.focus();
    if (first instanceof HTMLInputElement) {
      first.select();
      // (Long words show from their start.)
      first.scrollLeft = 0;
    }
    const outside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    // The list stays where it was placed: it closes when the knob moves from under it (the box the
    // knob is in scrolls, or the window changes size). Anything else may scroll (a text field does when it loses focus).
    const moved = (e: Event) => {
      if (root.current && (e.target as Node).contains(root.current)) setOpen(false);
    };
    const resized = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('scroll', moved, true);
    window.addEventListener('resize', resized);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('scroll', moved, true);
      window.removeEventListener('resize', resized);
    };
  }, [open]);

  const choose = (words: string) => {
    onChange(words);
    close(true);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') {
      // Only the list closes (not the dialog it may be in).
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    const step = ({ ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 } as Record<string, number>)[e.key];
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(e.target as HTMLElement);
    // The arrow keys walk the choices (in the text field they move the caret, as always).
    if (!step || at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    items[(at + step + items.length) % items.length].focus();
  };

  // With no style, the knob in the bar says what it is; on the home screen its name is above it.
  const name = preset ? preset.label : value || (look === 'bar' ? 'Art style' : 'None');
  return (
    <div className={`style-knob style-knob-${look}`} ref={root} onKeyDown={onKeyDown}>
      <button
        ref={knob}
        type="button"
        className={`style-knob-button ${open ? 'open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Art style: ${preset ? preset.label : value || 'none'}`}
        title={open ? undefined : value ? `Art style: ${value}` : 'Art style: none yet. Pick how the game looks.'}
        onClick={toggle}
      >
        {preset ? <span className="style-swatch" data-style={preset.id} aria-hidden="true" /> : <BrushIcon size={17} />}
        <span className="style-knob-name">{name}</span>
        <CaretDownIcon size={16} className="dropdown-caret" />
      </button>
      {open && (
        <div className="style-list" role="menu" aria-label="Art style" ref={list} tabIndex={-1} style={{ ...place, width: LIST_WIDTH }}>
          <div className="style-presets">
            {STYLE_PRESETS.map((p) => (
              <button key={p.id} type="button" role="menuitemradio" aria-checked={preset?.id === p.id} title={p.words} className={preset?.id === p.id ? 'on' : ''} onClick={() => choose(p.words)}>
                <span className="style-swatch" data-style={p.id} aria-hidden="true" />
                <span>{p.label}</span>
              </button>
            ))}
          </div>
          <div className="style-more">
            {custom === null ? (
              <button type="button" role="menuitemradio" aria-checked={own} className={own ? 'on' : ''} title="Type a style" onClick={() => setCustom('')}>
                <BrushIcon size={16} />
                <span>Custom…</span>
              </button>
            ) : (
              <form
                className="style-custom"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (custom.trim()) choose(custom.trim());
                }}
              >
                <input autoFocus value={custom} maxLength={200} placeholder="e.g. pixel art" aria-label="Your own art style" onChange={(e) => setCustom(e.target.value)} />
                <button type="submit" className="btn primary small" disabled={!custom.trim()}>
                  Use
                </button>
              </form>
            )}
            <button type="button" role="menuitemradio" aria-checked={!value} className={!value ? 'on' : ''} title="No style" onClick={() => choose('')}>
              <span className="style-swatch none" aria-hidden="true" />
              <span>None</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The style knob of the open project, in the top bar: it reads and writes the stage's art style: block. */
export function ProjectStyleKnob() {
  const style = useStore((s) => projectStyle(s.project));
  return <StyleKnob value={style} onChange={setStyle} />;
}
