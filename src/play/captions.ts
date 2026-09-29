/**
 * Captions for game sounds (§6.7, §3.9 rule 10): the words a game sends with a sound ("[boss roars]")
 * show for about 2.5 s each, two lines at most. A third caption drops the oldest line, and a sound that
 * plays again while its caption shows keeps that one line up longer instead of taking a second one.
 *
 * Pure (the caller's clock, no DOM): the editor's caption strip and a shared web page's both run it.
 */

/** How long one caption shows. */
export const CAPTION_MS = 2500;
/** The most caption lines on screen at once. */
export const CAPTION_LINES = 2;
/** Longer captions are cut (games send at most 60 characters, the Sounds sheet 40). */
export const CAPTION_CHARS = 80;

export interface CaptionLine {
  /** Stays the same while the line shows (a key for the view). */
  id: number;
  text: string;
  /** When it goes, on the caller's clock (ms). */
  until: number;
}

export class CaptionQueue {
  private seq = 0;
  private list: readonly CaptionLine[] = [];

  constructor(
    private readonly showMs = CAPTION_MS,
    private readonly maxLines = CAPTION_LINES,
  ) {}

  /** The lines showing at `now`, oldest first. The array only changes when the lines do. */
  lines(now: number): readonly CaptionLine[] {
    if (this.list.some((l) => l.until <= now)) this.list = this.list.filter((l) => l.until > now);
    return this.list;
  }

  /** A caption arrives at `now`: it becomes the newest line. Returns the lines to show. */
  push(text: string, now: number): readonly CaptionLine[] {
    const words = String(text).replace(/\s+/g, ' ').trim().slice(0, CAPTION_CHARS);
    const showing = this.lines(now);
    if (!words) return showing;
    const same = showing.find((l) => l.text === words);
    const line: CaptionLine = { id: same?.id ?? ++this.seq, text: words, until: now + this.showMs };
    this.list = [...showing.filter((l) => l !== same), line].slice(-this.maxLines);
    return this.list;
  }

  /** When the next line goes, or null when nothing shows. */
  nextChange(): number | null {
    return this.list.length ? Math.min(...this.list.map((l) => l.until)) : null;
  }

  clear(): readonly CaptionLine[] {
    if (this.list.length) this.list = [];
    return this.list;
  }
}
