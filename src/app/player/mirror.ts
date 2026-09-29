/**
 * The game's text mirror (§3.9 rule 4, §6.3): what a screen reader hears from a running game, in a polite
 * log beside it, apart from the app's two live regions. The game sends events; this turns them into short
 * sentences:
 * - the score at most once every 2 s and the hearts at most once a second, always the latest value (a burst
 *   of points is one "Score: 340." once it settles), and only when it changed;
 * - a new level, a win, a loss and the title card at once;
 * - the game's own messages (big titles, hints, speech, dialogue) at once, but never the same words twice in
 *   a row (the kit sends a wave's title as a message and as a level) and no more than 3 in 2 s;
 * - game text in capitals reads as a sentence ("WAVE 2" → "Wave 2.").
 * Sound captions are not here: they are for the eyes, and a listener hears the sound itself.
 *
 * Pure apart from its clock, which tests replace.
 */
import type { GameEvent } from '../../cores/play';
import { t } from '../../i18n';

export const SCORE_EVERY_MS = 2000;
export const HEARTS_EVERY_MS = 1000;
/** The same words again within this long are said once. */
export const REPEAT_MS = 3000;
/** At most this many of the game's own messages in `MESSAGE_WINDOW_MS`: more is noise to a listener. */
export const MESSAGE_BURST = 3;
export const MESSAGE_WINDOW_MS = 2000;
const MAX_CHARS = 200;

export interface MirrorClock {
  now(): number;
  /** Calls `fn` after `ms`; returns a function that cancels it. */
  later(fn: () => void, ms: number): () => void;
}

const realClock: MirrorClock = {
  now: () => performance.now(),
  later: (fn, ms) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

/** Game text as a listener should hear it: capitals become a sentence, spaces are tidied, length capped. */
export function speakable(text: string): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  if (/[a-z]/.test(s) || !/[A-Z].*[A-Z]/.test(s)) return s;
  return s.toLowerCase().replace(/(^|[.!?:]\s+)([a-z])/g, (_all, before: string, c: string) => before + c.toUpperCase());
}

/** Ends with a full stop unless it already ends a sentence. */
function sentence(s: string): string {
  return !s || /[.!?…]$/.test(s) ? s : `${s}.`;
}

function whole(n: number): number {
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function heartsWords(h: { value: number; max: number }): string {
  const n = Math.max(0, whole(h.value));
  const max = whole(h.max);
  return max > 0 && max >= n ? t('world.mirrorHearts', { n, max }) : t('world.mirrorHeartsNoMax', { n });
}

/** A number the game keeps changing (the score, the hearts), said at most once every `every` ms. */
class Throttled<T> {
  private saidAt = -Infinity;
  private said: string | null = null;
  private waiting: T | null = null;
  private cancel: (() => void) | null = null;

  constructor(
    private readonly every: number,
    private readonly clock: MirrorClock,
    private readonly words: (v: T) => string,
    private readonly say: (s: string) => void,
  ) {}

  push(v: T): void {
    const now = this.clock.now();
    if (!this.cancel && now - this.saidAt >= this.every) {
      this.speak(v, now);
      return;
    }
    // Too soon: the latest value waits for the end of the gap (a newer one replaces it meanwhile).
    this.waiting = v;
    this.cancel ??= this.clock.later(() => this.flush(), Math.max(0, this.saidAt + this.every - now));
  }

  /** Forgets a waiting value (a win or a loss already says the final score). */
  drop(): void {
    this.cancel?.();
    this.cancel = null;
    this.waiting = null;
  }

  reset(): void {
    this.drop();
    this.said = null;
    this.saidAt = -Infinity;
  }

  private flush(): void {
    this.cancel = null;
    const v = this.waiting;
    this.waiting = null;
    if (v !== null) this.speak(v, this.clock.now());
  }

  private speak(v: T, now: number): void {
    const s = this.words(v);
    if (s === this.said) return;
    this.said = s;
    this.saidAt = now;
    this.say(s);
  }
}

export class TextMirror {
  private readonly score: Throttled<number>;
  private readonly hearts: Throttled<{ value: number; max: number }>;
  /** What was said lately, so the same words are said once. */
  private recent: Array<{ text: string; at: number }> = [];
  /** When the game's own messages were said. */
  private messages: number[] = [];

  constructor(
    private readonly say: (text: string) => void,
    private readonly clock: MirrorClock = realClock,
  ) {
    this.score = new Throttled(SCORE_EVERY_MS, clock, (n) => t('world.mirrorScore', { n: whole(n) }), (s) => this.out(s));
    this.hearts = new Throttled(HEARTS_EVERY_MS, clock, heartsWords, (s) => this.out(s));
  }

  event(e: GameEvent): void {
    switch (e.kind) {
      case 'score':
        this.score.push(e.value);
        return;
      case 'lives':
        this.hearts.push({ value: e.value, max: e.max });
        return;
      case 'level':
        this.once(sentence(speakable(e.text)) || t('world.mirrorLevel', { n: whole(e.value) }));
        return;
      case 'win':
        this.score.drop();
        this.once(t('world.mirrorWin', { text: sentence(speakable(e.text)) || t('world.mirrorYouWin'), score: whole(e.score) }));
        return;
      case 'lose':
        this.score.drop();
        this.once(t('world.mirrorLose', { text: sentence(speakable(e.text)) || t('world.mirrorGameOver'), score: whole(e.score) }));
        return;
      case 'title': {
        // A title card starts a new run: its score and hearts are new.
        this.score.reset();
        this.hearts.reset();
        const title = sentence(speakable(e.text));
        const sub = sentence(speakable(e.sub));
        if (title) this.once(sub ? t('world.mirrorTitleSub', { title, sub }) : t('world.mirrorTitle', { title }));
        return;
      }
      case 'text':
        this.message(sentence(speakable(e.text)));
        return;
      case 'start':
      case 'caption':
        return;
    }
  }

  /** A new game: nothing from the last one is said. */
  reset(): void {
    this.score.reset();
    this.hearts.reset();
    this.recent = [];
    this.messages = [];
  }

  dispose(): void {
    this.score.drop();
    this.hearts.drop();
  }

  private message(text: string): void {
    if (!text) return;
    const now = this.clock.now();
    this.messages = this.messages.filter((at) => now - at < MESSAGE_WINDOW_MS);
    if (this.messages.length >= MESSAGE_BURST || this.saidLately(text, now)) return;
    this.messages.push(now);
    this.out(text);
  }

  private once(text: string): void {
    if (text && !this.saidLately(text, this.clock.now())) this.out(text);
  }

  private saidLately(text: string, now: number): boolean {
    this.recent = this.recent.filter((r) => now - r.at < REPEAT_MS);
    return this.recent.some((r) => r.text === text);
  }

  private out(text: string): void {
    this.recent.push({ text, at: this.clock.now() });
    this.say(text);
  }
}
