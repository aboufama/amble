import { CHANNEL, type FromPlayer, type PlayerError, type ToPlayer } from '../player/protocol';

/** Sends a message to the editor that hosts this player. */
export function post(msg: FromPlayer): void {
  window.parent.postMessage({ channel: CHANNEL, ...msg }, '*');
}

export function onEditorMessage(handler: (msg: ToPlayer) => void): void {
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data as (ToPlayer & { channel?: string }) | null;
    if (!data || data.channel !== CHANNEL) return;
    handler(data);
  });
}

/** Line offset added by `new Function(...params, body)`: "function anonymous(a,b\n) {\n" */
export const FUNCTION_LINE_OFFSET = 2;

export function sourceUrlFor(targetName: string): string {
  return `amble:///${encodeURIComponent(targetName)}.js`;
}

/** Finds the line (in the target's compiled code) where an error happened. */
export function errorLine(err: unknown, targetName: string | undefined): number | undefined {
  if (!targetName || !(err instanceof Error) || !err.stack) return undefined;
  const marker = sourceUrlFor(targetName);
  for (const line of err.stack.split('\n')) {
    const at = line.indexOf(marker + ':');
    if (at === -1) continue;
    const match = /^:(\d+):(\d+)/.exec(line.slice(at + marker.length));
    if (match) {
      const n = Number(match[1]) - FUNCTION_LINE_OFFSET;
      if (n >= 1) return n;
    }
  }
  return undefined;
}

let reported = new Set<string>();
let reportCount = 0;

/** Reports a script error to the editor (each distinct error once per run). */
export function reportError(err: unknown, ctx: Omit<PlayerError, 'message' | 'line'>): void {
  const message = err instanceof Error ? err.message || err.name : String(err);
  const key = `${ctx.phase}|${ctx.target}|${ctx.script}|${message}`;
  if (reported.has(key) || reportCount > 40) return;
  reported.add(key);
  reportCount++;
  post({ type: 'error', message, line: errorLine(err, ctx.target), ...ctx });
  realConsole.error(err);
}

export function resetReports(): void {
  reported = new Set();
  reportCount = 0;
  logCount = 0;
  warned = new Set();
}

let warned = new Set<string>();
/** Logs a warning to the editor console once per run. */
export function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  post({ type: 'log', level: 'warn', message });
}

const realConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
let logCount = 0;

function stringify(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

/** Mirrors console output from game code into the editor's console panel. */
export function forwardConsole(): void {
  const forward = (level: 'log' | 'warn' | 'error', args: unknown[]) => {
    if (logCount++ > 200) return;
    post({ type: 'log', level, message: stringify(args).slice(0, 500) });
  };
  console.log = (...args: unknown[]) => {
    realConsole.log(...args);
    forward('log', args);
  };
  console.info = (...args: unknown[]) => {
    realConsole.info(...args);
    forward('log', args);
  };
  console.warn = (...args: unknown[]) => {
    realConsole.warn(...args);
    forward('warn', args);
  };
  console.error = (...args: unknown[]) => {
    realConsole.error(...args);
    forward('error', args);
  };
  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, { phase: 'run' });
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { phase: 'run' });
  });
}
