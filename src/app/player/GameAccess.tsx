/**
 * What a running game says in words (§3.9 rules 4 and 10, §6.3, §6.7), placed inside a player slot's box:
 * - **Captions**: while Settings → Sound → Captions is on, the words a game sends with its sounds
 *   ("[boss roars]") in a strip at the bottom edge of the game, about 2.5 s each and two lines at most
 *   (src/play/captions.ts). It never takes clicks, and it stays above the cards the screen puts at the
 *   bottom of the game (`avoid`: the request tag, the problem card...).
 * - **The text mirror**: a visually hidden polite log, always there, where a screen reader hears the score,
 *   the hearts, levels, a win or a loss, the title card and the game's messages (src/app/player/mirror.ts).
 *   It is apart from the app's two live regions.
 *
 * One game shows at a time, so each screen that shows it (the world, Look inside, the Desk's preview, the
 * Teacher desk's gallery and Present) mounts one of these in its slot.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { CaptionQueue, type CaptionLine } from '../../cores/play';
import { t } from '../../i18n';
import { getState, useStore } from '../../state/store';
import { cx } from '../../ui/cx';
import { useServices } from '../services';
import { TextMirror } from './mirror';
import './access.css';

/** How many of the mirror's sentences stay in the log (older ones leave quietly). */
const LOG_KEEP = 8;
/** Space between the captions and a card they stay above, and their inset from the game's edge. */
const GAP = 8;

export interface GameAccessProps {
  /** Cards at the bottom of the game the captions must stay above (a selector inside the same box). */
  avoid?: string;
  /** A small game (the Desk's preview): smaller caption type. */
  compact?: boolean;
}

/** How far up the captions must sit to clear the cards in `avoid` (0 when none shows). */
function useLift(strip: RefObject<HTMLDivElement | null>, avoid: string | undefined, lines: readonly CaptionLine[]): number {
  const [lift, setLift] = useState(0);
  const showing = lines.length > 0;
  useLayoutEffect(() => {
    const box = strip.current?.parentElement;
    if (!avoid || !showing || !box) {
      setLift(0);
      return;
    }
    const measure = () => {
      const bottom = box.getBoundingClientRect().bottom;
      let need = 0;
      for (const card of box.querySelectorAll<HTMLElement>(avoid)) {
        const r = card.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) need = Math.max(need, bottom - r.top);
      }
      setLift(need > 0 ? Math.ceil(need) + GAP : 0);
    };
    measure();
    // Cards come and go (React), change size (text size, a window resize) and slide in (their entrance).
    const mo = new MutationObserver(measure);
    mo.observe(box, { childList: true, subtree: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(box);
    for (const card of box.querySelectorAll<HTMLElement>(avoid)) ro?.observe(card);
    box.addEventListener('animationend', measure);
    return () => {
      mo.disconnect();
      ro?.disconnect();
      box.removeEventListener('animationend', measure);
    };
  }, [strip, avoid, showing, lines]);
  return lift;
}

export function GameAccess({ avoid, compact = false }: GameAccessProps) {
  const { player } = useServices();
  const captionsOn = useStore((s) => s.prefs.captions);
  const [lines, setLines] = useState<readonly CaptionLine[]>([]);
  const [log, setLog] = useState<Array<{ id: number; text: string }>>([]);
  const queue = useRef(new CaptionQueue());
  const strip = useRef<HTMLDivElement>(null);
  const lift = useLift(strip, avoid, lines);

  useEffect(() => {
    const captions = queue.current;
    let timer = 0;
    let said = 0;
    // Each line goes when its time is up: one timer, for the next line to go.
    const show = () => {
      window.clearTimeout(timer);
      const now = performance.now();
      setLines(captions.lines(now));
      const next = captions.nextChange();
      if (next !== null) timer = window.setTimeout(show, Math.max(16, next - now));
    };
    const mirror = new TextMirror((text) => setLog((l) => [...l.slice(1 - LOG_KEEP), { id: ++said, text }]));
    const offEvent = player.on('event', ({ event }) => {
      if (event.kind !== 'caption') {
        mirror.event(event);
        return;
      }
      if (!getState().prefs.captions) return;
      captions.push(event.text, performance.now());
      show();
    });
    // Another game starts: nothing from the last one shows or is said.
    const offState = player.on('state', ({ state }) => {
      if (state !== 'loading') return;
      mirror.reset();
      captions.clear();
      show();
    });
    return () => {
      offEvent();
      offState();
      mirror.dispose();
      window.clearTimeout(timer);
    };
  }, [player]);

  // Captions switched off: the strip empties at once.
  useEffect(() => {
    if (!captionsOn) setLines(queue.current.clear());
  }, [captionsOn]);

  const showing = captionsOn && lines.length > 0;
  return (
    <>
      <div
        ref={strip}
        className={cx('game-captions', compact && 'game-captions--compact')}
        style={lift ? { bottom: lift } : undefined}
        hidden={!showing}
        data-testid="game-captions"
      >
        {showing &&
          lines.map((l) => (
            <p key={l.id} className="game-captions__line">
              {l.text}
            </p>
          ))}
      </div>
      <div className="sr-only" role="log" aria-live="polite" aria-label={t('world.mirrorLabel')} data-testid="game-mirror">
        {log.map((m) => (
          <p key={m.id}>{m.text}</p>
        ))}
      </div>
    </>
  );
}
