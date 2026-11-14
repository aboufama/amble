import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Dial } from '../blocks/spec';
import { DIAL_STOPS, projectDial, projectIdea } from '../project/controls';
import { setDial } from '../actions';
import { useStore } from '../store';

interface GameDialProps {
  value: Dial;
  onChange(dial: Dial): void;
  /**
   * 'bar' (the top bar): compact, with the stop's name beside it and each stop explained in a card
   * as you point at it. 'page' (the home screen): roomy, with every stop's name under it.
   */
  look?: 'bar' | 'page';
  /** The stop being pointed at (or reached with the keyboard), to explain it elsewhere; null when none is. */
  onPreview?(dial: Dial | null): void;
  /** One more line for the card that explains a stop, if there is something to add. */
  note?(stop: Dial): string | undefined;
}

/**
 * The dial: how much of the game Amble makes from the game: line, in five stops from "My blocks"
 * (nothing) to "Grand". One radio group: Tab reaches the stop it stands on, the arrow keys (and
 * Home and End) move it.
 */
export function GameDial({ value, onChange, look = 'bar', onPreview, note }: GameDialProps) {
  const [hover, setHover] = useState<Dial | null>(null);
  const [focus, setFocus] = useState<Dial | null>(null);
  const stops = useRef<Array<HTMLButtonElement | null>>([]);
  const shown = hover ?? focus;

  const point = (next: { hover?: Dial | null; focus?: Dial | null }) => {
    const h = next.hover !== undefined ? next.hover : hover;
    const f = next.focus !== undefined ? next.focus : focus;
    if (next.hover !== undefined) setHover(next.hover);
    if (next.focus !== undefined) setFocus(next.focus);
    onPreview?.(h ?? f);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const to = ({ ArrowRight: value + 1, ArrowUp: value + 1, ArrowLeft: value - 1, ArrowDown: value - 1, Home: 0, End: DIAL_STOPS.length - 1 } as Record<string, number>)[e.key];
    if (to === undefined || e.metaKey || e.ctrlKey || e.altKey) return;
    // The dial has the keys: not the game on the stage, and not the block editor.
    e.preventDefault();
    e.stopPropagation();
    const next = Math.min(DIAL_STOPS.length - 1, Math.max(0, to)) as Dial;
    if (next !== value) onChange(next);
    stops.current[next]?.focus();
  };

  return (
    <div className={`dial dial-${look}`} role="radiogroup" aria-label="Dial: how much of the game Amble makes" onKeyDown={onKeyDown} onMouseLeave={() => point({ hover: null })}>
      <div className="dial-track" style={{ '--dial': value } as CSSProperties}>
        {DIAL_STOPS.map((s) => (
          <button
            key={s.dial}
            ref={(el) => void (stops.current[s.dial] = el)}
            type="button"
            role="radio"
            aria-checked={s.dial === value}
            aria-label={s.label}
            aria-description={s.hint}
            // (In the bar the card explains the stops; on a page, whoever shows the dial does, or else the browser's tip.)
            title={look === 'page' && !onPreview ? s.hint : undefined}
            tabIndex={s.dial === value ? 0 : -1}
            className={`dial-stop ${s.dial === value ? 'on' : s.dial < value ? 'past' : ''}`}
            onClick={() => onChange(s.dial)}
            onMouseEnter={() => point({ hover: s.dial })}
            // Reached with the keyboard, a stop is explained like one pointed at (a click only sets it).
            onFocus={(e) => point({ focus: e.currentTarget.matches(':focus-visible') ? s.dial : null })}
            onBlur={() => point({ focus: null })}
          >
            <span className="dial-dot" />
            {look === 'page' && <span className="dial-label">{s.label}</span>}
          </button>
        ))}
      </div>
      {look === 'bar' && (
        <span className="dial-name" aria-hidden="true">
          {DIAL_STOPS[value].label}
        </span>
      )}
      {look === 'bar' && shown !== null && (
        <div className="dial-card" role="tooltip">
          <b>{DIAL_STOPS[shown].label}</b>
          <span>{DIAL_STOPS[shown].hint}</span>
          {note?.(shown) && <span className="dial-note">{note(shown)}</span>}
        </div>
      )}
    </div>
  );
}

/** The dial of the open project, in the top bar. */
export function ProjectDial() {
  const dial = useStore((s) => projectDial(s.project));
  const idea = useStore((s) => projectIdea(s.project));
  // Past "My blocks" the game is made from the stage's game: line (so it needs one), and by the green flag, not at once.
  const note = (stop: Dial) => (stop === 0 ? undefined : !idea ? 'It needs a game: block on the stage that says what the game is.' : stop !== dial ? 'Then the green flag makes the game again.' : undefined);
  return <GameDial value={dial} onChange={setDial} note={note} />;
}
