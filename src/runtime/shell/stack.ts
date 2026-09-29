/**
 * Maps errors back to the student's own file and line.
 *
 * Student files run as classic blob: scripts ending in `//# sourceURL=amble:///<file>`, so stack frames
 * read `amble:///game.js:12:5` (Chrome: "at update (amble:///game.js:12:5)", Firefox/Safari:
 * "update@amble:///game.js:12:5"). Syntax errors carry the blob: URL instead. No line offset: the files
 * are not wrapped, so line numbers match what the student sees.
 */

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

export const SOURCE_URL_PREFIX = 'amble:///';

/** The sourceURL a student file is loaded under. */
export function sourceUrlFor(file: string): string {
  return SOURCE_URL_PREFIX + encodeURIComponent(file);
}

const FRAME = /((?:amble:\/\/\/[^\s():]+)|(?:blob:[^\s()]+?)):(\d+):(\d+)/;

/**
 * The first stack frame that belongs to a student file. `fileFor` maps a script URL (amble:///x or blob:...)
 * to the student's file name, or returns undefined for runtime and Phaser frames.
 */
export function locateInStack(stack: string, fileFor: (url: string) => string | undefined): SourceLocation | null {
  for (const line of stack.split('\n')) {
    const m = FRAME.exec(line);
    if (!m) continue;
    const file = fileFor(m[1]);
    if (file) return { file, line: Number(m[2]), column: Number(m[3]) };
  }
  return null;
}

/** Keeps only the first few frames, with blob: URLs replaced by the student file names, for the error panel. */
export function tidyStack(stack: string, fileFor: (url: string) => string | undefined, maxFrames = 6): string {
  return stack
    .split('\n')
    .slice(0, maxFrames + 1)
    .map((line) => line.replace(/(amble:\/\/\/[^\s():]+|blob:[^\s()]+?)(?=:\d+:\d+)/g, (url) => fileFor(url) ?? 'amble'))
    .join('\n');
}

/** A one-line message a 10-year-old can act on: "Something broke on line 12 of game.js: ...". */
export function describeError(message: string, where: Partial<SourceLocation> | null): string {
  const clean = message.replace(/^Uncaught\s+/, '').trim() || 'Something went wrong';
  if (where?.file && where.line) return `Something broke on line ${where.line} of ${where.file}: ${clean}`;
  return `Something broke: ${clean}`;
}

/** Tracks the student's scripts so stack frames can be mapped back to them. */
export class ScriptRegistry {
  private readonly byUrl = new Map<string, string>();

  add(file: string, blobUrl: string | null): void {
    this.byUrl.set(sourceUrlFor(file), file);
    if (blobUrl) this.byUrl.set(blobUrl, file);
  }

  fileFor = (url: string): string | undefined => this.byUrl.get(url);

  /** Where an error happened: its stack first, then the ErrorEvent's file/line (syntax errors). */
  locate(err: unknown, event?: { filename?: string; lineno?: number; colno?: number }): SourceLocation | null {
    const stack = err instanceof Error && typeof err.stack === 'string' ? err.stack : '';
    const fromStack = stack ? locateInStack(stack, this.fileFor) : null;
    if (fromStack) return fromStack;
    if (event?.filename) {
      const file = this.fileFor(event.filename);
      if (file && event.lineno) return { file, line: event.lineno, column: event.colno ?? 0 };
    }
    return null;
  }
}

export interface ErrorRecord {
  key: string;
  count: number;
}

/**
 * Deduplicates errors (same message at the same place) and caps how many distinct ones a run reports,
 * so a throw in update() does not flood the editor 60 times a second.
 */
export class ErrorDeduper {
  private readonly seen = new Map<string, ErrorRecord>();

  constructor(private readonly maxDistinct = 50) {}

  /** Returns the record and whether this is the first time it was seen, or null once the cap is reached. */
  note(message: string, where: SourceLocation | null): { record: ErrorRecord; first: boolean } | null {
    const key = `${message}|${where?.file ?? ''}|${where?.line ?? ''}`;
    const known = this.seen.get(key);
    if (known) {
      known.count++;
      return { record: known, first: false };
    }
    if (this.seen.size >= this.maxDistinct) return null;
    const record = { key, count: 1 };
    this.seen.set(key, record);
    return { record, first: true };
  }

  get distinct(): number {
    return this.seen.size;
  }

  reset(): void {
    this.seen.clear();
  }
}
