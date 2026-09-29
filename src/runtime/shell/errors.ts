/**
 * Error capture for the game realm: every error is mapped to the student's file and line, deduplicated,
 * reported to the editor, and (when it comes from the running game) stops the simulation while the game
 * keeps rendering, with the kid-facing panel on top.
 */
import type { ErrorPhase, FromPlayer, LogLevel, PlayerError } from '../../play/protocol';
import { showErrorPanel } from './overlay';
import { describeError, ErrorDeduper, ScriptRegistry, tidyStack, type SourceLocation } from './stack';

export interface ErrorSink {
  post(msg: FromPlayer): void;
}

/** The browser's own console.warn, captured before game output is forwarded (so the runtime's notes stay local). */
const nativeWarn = console.warn.bind(console);

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name && err.name !== 'Error' ? `${err.name}: ` : '';
    return name + (err.message || 'Something went wrong');
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

export interface ReportDetails {
  /** The window ErrorEvent's location (syntax errors carry no stack). */
  event?: { filename?: string; lineno?: number; colno?: number };
  crash?: boolean;
  twist?: string;
}

export class ErrorReporter {
  readonly scripts = new ScriptRegistry();
  private readonly deduper = new ErrorDeduper(50);
  /** Errors of this run, for the robot test report. */
  readonly errors: PlayerError[] = [];
  crashed = false;
  showPanel = true;
  /** The phase window errors are reported under ('load' while the game's files run). */
  globalPhase: ErrorPhase = 'uncaught';
  private onCrash: (() => void) | null = null;

  constructor(private readonly sink: ErrorSink) {}

  setCrashHandler(fn: () => void): void {
    this.onCrash = fn;
  }

  /**
   * Reports an error. `crash` (default true) stops the simulation: a broken game should say so clearly
   * instead of carrying on in a weird state. Callbacks the kit runs report with `crash: false` (the kit
   * switches a callback off after 3 errors), and so do twists (`twist` names the one that broke).
   */
  report(err: unknown, phase: ErrorPhase, o: ReportDetails = {}): void {
    const crash = o.crash ?? true;
    const message = messageOf(err).slice(0, 500);
    const where: SourceLocation | null = this.scripts.locate(err, o.event);
    const noted = this.deduper.note(message, where);
    if (!noted) return;
    const { record, first } = noted;
    const error: PlayerError = { phase, message, count: record.count, fatal: crash };
    if (o.twist) error.twist = o.twist;
    if (where) {
      error.file = where.file;
      error.line = where.line;
      error.column = where.column;
    }
    if (err instanceof Error && typeof err.stack === 'string') error.stack = tidyStack(err.stack, this.scripts.fileFor).slice(0, 2000);
    if (first) {
      this.errors.push(error);
      nativeWarn('[amble]', describeError(message, where));
    } else {
      const known = this.errors.find((e) => e.message === message && e.line === error.line && e.file === error.file);
      if (known) known.count = record.count;
    }
    // Repeats are re-posted sparingly so the editor's count stays roughly right.
    if (first || record.count === 10 || record.count === 100 || record.count % 1000 === 0) this.sink.post({ type: 'error', error });
    if (crash && !this.crashed) {
      this.crashed = true;
      if (this.showPanel) showErrorPanel(where ? `Oops! Something broke on line ${where.line} of ${where.file}.` : 'Oops! Something broke.', message);
      this.onCrash?.();
    }
  }

  /** Clears the crash so the game can run again (a level restart). Errors seen before stay counted. */
  recover(): void {
    this.crashed = false;
  }

  /** Window-level catchers: DOM handlers, timers, promises, CSP. */
  captureGlobal(): void {
    window.addEventListener('error', (e: ErrorEvent) => {
      this.report(e.error ?? e.message, this.globalPhase, { event: { filename: e.filename, lineno: e.lineno, colno: e.colno } });
    });
    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => this.report(e.reason, 'promise'));
    document.addEventListener('securitypolicyviolation', (e: SecurityPolicyViolationEvent) => {
      this.sink.post({ type: 'csp', directive: e.effectiveDirective, blocked: String(e.blockedURI).slice(0, 120) });
    });
  }

  /** Mirrors console output from game code into the editor's console, with a budget. */
  forwardConsole(): void {
    let budget = 400;
    const levels: LogLevel[] = ['log', 'info', 'warn', 'error'];
    const c = console as unknown as Record<LogLevel, (...args: unknown[]) => void>;
    for (const level of levels) {
      const real = c[level].bind(console);
      c[level] = (...args: unknown[]) => {
        real(...args);
        if (budget-- <= 0) return;
        const text = args
          .map((a) => {
            if (typeof a === 'string') return a;
            if (a instanceof Error) return a.message;
            try {
              return JSON.stringify(a) ?? String(a);
            } catch {
              return String(a);
            }
          })
          .join(' ');
        this.sink.post({ type: 'log', level, message: text.slice(0, 500) });
      };
    }
  }
}
