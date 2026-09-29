/**
 * Reads AMBLE PATCH replies, as they stream. A line starting with `@@` is a directive:
 *
 *   @@amble-patch 1
 *   @@summary <one sentence>        @@play <how to play>        @@next <idea> | <idea> | <idea>
 *   @@safety ok | toned-down: <note> | refused: <note> | crisis
 *   @@file <name>.js create|replace       (the whole file follows)
 *   @@file <name>.js edit                 (then @@find / lines / @@replace / lines / @@done, repeated)
 *   @@file <name>.js delete
 *   @@end
 *
 * Tolerant of what models do: prose or fences before the header, a fence around a file body,
 * CRLF, a missing @@done, a mislabeled block. On truncation (no @@end), complete blocks are kept
 * and the cut-off one is named in `truncatedIn`.
 */
import type { Edit, FileAction, FileOp, Patch, PatchEvent, SafetyStatus } from './types';

type State = 'preamble' | 'top' | 'body' | 'edit' | 'find' | 'replace' | 'done';

interface Block {
  path: string;
  action: FileAction;
  lines: string[];
  edits: Edit[];
  malformed: string[];
  find: string[];
  replace: string[];
}

const FENCE_OPEN = /^\s*```[\w+-]*\s*$/;
const FENCE_CLOSE = /^\s*```\s*$/;
const ACTIONS: Record<string, FileAction> = {
  create: 'create', new: 'create', add: 'create',
  replace: 'replace', rewrite: 'replace', full: 'replace', write: 'replace', overwrite: 'replace',
  edit: 'edit', patch: 'edit', modify: 'edit', update: 'edit', change: 'edit',
  delete: 'delete', remove: 'delete',
};

function trimBlankEnds(lines: string[], leading: boolean): string[] {
  let a = 0;
  let b = lines.length;
  if (leading) while (a < b && lines[a].trim() === '') a++;
  while (b > a && lines[b - 1].trim() === '') b--;
  return lines.slice(a, b);
}

/** A whole-file body: without a fence the model wrapped around it, without trailing blank lines. */
function bodyText(lines: string[]): string {
  let l = trimBlankEnds(lines, true);
  if (l.length && FENCE_CLOSE.test(l[l.length - 1])) {
    l = l.slice(0, -1);
    if (l.length && FENCE_OPEN.test(l[0])) l = l.slice(1);
    l = trimBlankEnds(l, true);
  }
  return l.length ? `${l.join('\n')}\n` : '';
}

function readSafety(arg: string): { status: SafetyStatus; note: string } | null {
  const t = arg.trim();
  if (/^ok\b/i.test(t)) return { status: 'ok', note: '' };
  const toned = /^tone[ds]?[- ]?down\s*:?\s*(.*)$/i.exec(t) ?? /^toned\s*:?\s*(.*)$/i.exec(t);
  if (toned) return { status: 'toned-down', note: toned[1].trim() };
  const refused = /^refus(?:ed|e|al)\s*:?\s*(.*)$/i.exec(t);
  if (refused) return { status: 'refused', note: refused[1].trim() };
  if (/^crisis\b/i.test(t)) return { status: 'crisis', note: '' };
  return null;
}

export class PatchParser {
  private state: State = 'preamble';
  private buffer = '';
  private block: Block | null = null;
  private readonly ops: FileOp[] = [];
  private readonly warnings: string[] = [];
  private version: number | null = null;
  private summary = '';
  private play = '';
  private next: string[] = [];
  private safety: { status: SafetyStatus; note: string } = { status: 'ok', note: '' };
  private events: PatchEvent[] = [];
  private lineNo = 0;

  /** Feeds more of the reply; returns the events it completed. */
  feed(chunk: string): PatchEvent[] {
    this.events = [];
    this.buffer += chunk;
    let i: number;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i);
      this.buffer = this.buffer.slice(i + 1);
      this.line(line.endsWith('\r') ? line.slice(0, -1) : line);
    }
    return this.events;
  }

  /**
   * The reply ended: finishes the last line and returns the patch. A last line that is a directive
   * cut off mid-way (`@@repl`) is dropped rather than read, so a cut-off block never looks complete.
   */
  end(): Patch {
    if (this.buffer) {
      const last = this.buffer.endsWith('\r') ? this.buffer.slice(0, -1) : this.buffer;
      this.buffer = '';
      this.events = [];
      if (!last.startsWith('@@') || /^@@end\s*$/i.test(last)) this.line(last);
    }
    return this.snapshot(true);
  }

  /** The patch as far as it is complete now (the open block is not included). */
  snapshot(final = false): Patch {
    const complete = this.state === 'done';
    const warnings = [...this.warnings];
    let ops = [...this.ops];
    if (final && this.version === null && this.state === 'preamble') warnings.push('No AMBLE PATCH was found in the reply.');
    if (final && !complete && this.state !== 'preamble') warnings.push(this.block ? `The reply stopped inside ${this.block.path}.` : 'The reply stopped before @@end.');
    if ((this.safety.status === 'refused' || this.safety.status === 'crisis') && ops.length) {
      warnings.push(`Ignored ${ops.length} file block(s): the reply said ${this.safety.status}.`);
      ops = [];
    }
    return {
      version: this.version,
      summary: this.summary,
      play: this.play,
      next: [...this.next],
      safety: { ...this.safety },
      ops,
      complete,
      truncatedIn: complete ? null : (this.block?.path ?? null),
      warnings,
    };
  }

  /** The block being written right now, for progress ("Writing boss.js") and early peeks at its text. */
  openBlock(): { path: string; action: FileAction; text: string } | null {
    if (!this.block) return null;
    const b = this.block;
    return { path: b.path, action: b.action, text: b.action === 'edit' ? b.replace.join('\n') : b.lines.join('\n') };
  }

  private warn(message: string): void {
    this.warnings.push(`line ${this.lineNo}: ${message}`);
  }

  private line(line: string): void {
    this.lineNo++;
    if (this.state === 'done') return;
    if (line.startsWith('@@')) this.directive(line);
    else this.content(line);
  }

  private content(line: string): void {
    const b = this.block;
    if (this.state === 'body' && b) {
      b.lines.push(line);
      this.events.push({ type: 'lines', path: b.path, count: b.lines.length });
    } else if (this.state === 'find' && b) b.find.push(line);
    else if (this.state === 'replace' && b) {
      b.replace.push(line);
      this.events.push({ type: 'lines', path: b.path, count: b.replace.length });
    }
    // Anything else (prose around blocks) is ignored.
  }

  private directive(line: string): void {
    const m = /^@@([A-Za-z][\w-]*):?\s*(.*)$/.exec(line.trimEnd());
    const name = m ? m[1].toLowerCase() : '';
    const arg = m ? m[2] : '';
    if (this.state === 'preamble' && name !== 'amble-patch') {
      if (!['file', 'summary', 'play', 'next', 'safety', 'end'].includes(name)) return;
      this.warn('The @@amble-patch header is missing.');
      this.start(1);
    }
    switch (name) {
      case 'amble-patch':
        if (this.state === 'preamble') this.start(Number.parseInt(arg, 10) || 1);
        return;
      case 'summary':
      case 'play':
      case 'next':
      case 'safety':
        this.closeBlock();
        this.header(name, arg);
        return;
      case 'file':
        this.closeBlock();
        this.openFile(arg);
        return;
      case 'find':
        this.find();
        return;
      case 'replace':
        if (this.state === 'find') this.state = 'replace';
        else this.warn('@@replace without @@find.');
        return;
      case 'done':
        if (this.state === 'replace') this.finishEdit();
        else if (this.state === 'find') this.malformedEdit('a @@find without @@replace');
        else if (this.state === 'body') this.closeBlock();
        return;
      case 'end':
        this.closeBlock();
        this.state = 'done';
        this.events.push({ type: 'end' });
        return;
      default:
        this.warn(`Unknown directive "${line.slice(0, 40)}".`);
        this.closeBlock();
    }
  }

  private start(version: number): void {
    this.version = version;
    this.state = 'top';
    this.events.push({ type: 'start', version });
  }

  private header(name: 'summary' | 'play' | 'next' | 'safety', arg: string): void {
    if (name === 'summary') this.summary = arg.trim();
    if (name === 'play') this.play = arg.trim();
    if (name === 'next') this.next = arg.split('|').map((s) => s.trim()).filter(Boolean).slice(0, 5);
    if (name === 'safety') {
      const s = readSafety(arg);
      if (s) this.safety = s;
      else this.warn(`Unknown safety value "${arg.slice(0, 40)}".`);
    }
    this.events.push({ type: 'header', name });
  }

  private openFile(arg: string): void {
    const m = /^["'`]?([^\s"'`]+)["'`]?(?:\s+\(?([A-Za-z]+)\)?)?/.exec(arg.trim());
    if (!m) {
      this.warn('@@file without a file name.');
      this.state = 'top';
      return;
    }
    const path = m[1];
    const action = m[2] ? ACTIONS[m[2].toLowerCase()] : 'create';
    if (!action) {
      this.warn(`Unknown file action "${m[2]}" for ${path}.`);
      this.state = 'top';
      return;
    }
    this.events.push({ type: 'file', path, action });
    if (action === 'delete') {
      this.pushOp({ action: 'delete', path });
      this.state = 'top';
      return;
    }
    this.block = { path, action, lines: [], edits: [], malformed: [], find: [], replace: [] };
    this.state = action === 'edit' ? 'edit' : 'body';
  }

  private find(): void {
    const b = this.block;
    if (!b) {
      this.warn('@@find outside a file block.');
      return;
    }
    if (this.state === 'body') {
      // Labeled create/replace but written as edits: read it as an edit block.
      if (b.lines.some((l) => l.trim() !== '')) {
        this.warn(`${b.path}: @@find inside a whole-file block.`);
        b.malformed.push('a @@find inside a whole-file block');
      }
      b.action = 'edit';
      b.lines = [];
    } else if (this.state === 'replace') {
      this.warn(`${b.path}: @@done missing before @@find.`);
      this.finishEdit();
    } else if (this.state === 'find') {
      this.malformedEdit('a @@find without @@replace');
    }
    b.find = [];
    b.replace = [];
    this.state = 'find';
  }

  private finishEdit(): void {
    const b = this.block;
    if (!b) return;
    b.edits.push({ find: trimBlankEnds(b.find, true).join('\n'), replace: trimBlankEnds(b.replace, false).join('\n') });
    b.find = [];
    b.replace = [];
    this.state = 'edit';
  }

  private malformedEdit(what: string): void {
    const b = this.block;
    if (!b) return;
    this.warn(`${b.path}: ${what}.`);
    b.malformed.push(what);
    b.find = [];
    b.replace = [];
    this.state = 'edit';
  }

  private closeBlock(): void {
    const b = this.block;
    if (!b) return;
    if (this.state === 'replace') {
      this.warn(`${b.path}: @@done missing at the end of an edit.`);
      this.finishEdit();
    } else if (this.state === 'find') {
      this.malformedEdit('a @@find without @@replace');
    }
    if (b.action === 'edit') {
      if (b.edits.length || b.malformed.length) this.pushOp({ action: 'edit', path: b.path, edits: b.edits, malformed: b.malformed });
      else this.warn(`${b.path}: an edit block with no edits.`);
    } else {
      this.pushOp({ action: b.action === 'replace' ? 'replace' : 'create', path: b.path, content: bodyText(b.lines) });
    }
    this.block = null;
    this.state = 'top';
  }

  private pushOp(op: FileOp): void {
    this.ops.push(op);
    this.events.push({ type: 'fileDone', op });
  }
}

/** Parses a whole reply at once. */
export function parsePatch(text: string): Patch {
  const p = new PatchParser();
  p.feed(text);
  return p.end();
}
