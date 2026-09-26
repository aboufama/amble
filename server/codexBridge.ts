/**
 * "Sign in with ChatGPT" for local runs.
 *
 * OpenAI only lets its own Codex app sign in with ChatGPT, so when Amble runs on your computer
 * (npm run dev / npm run preview), this dev-server bridge hands AI requests to the Codex CLI
 * you already have (`npm install -g @openai/codex`). Codex signs in with your ChatGPT account
 * and runs each request on your plan.
 *
 * Every request runs `codex exec` in an empty temporary folder with a read-only sandbox, no web
 * search, without your Codex config (`--ignore-user-config`), and without saving a session
 * (`--ephemeral`). The answer must match a JSON schema (`--output-schema`).
 *
 *   GET  /api/codex/status        is Codex installed, and how is it signed in?
 *   POST /api/codex/login         start `codex login` (opens the ChatGPT sign-in page)
 *   POST /api/codex/login/cancel  stop a sign-in that's waiting
 *   POST /api/codex/run           one structured request; replies with NDJSON progress + result
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Connect } from 'vite';
import type { CodexAuth, CodexRunEvent, CodexRunRequest, CodexStatus } from '../src/compiler/codexTypes.ts';

const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const INSTALL_HINT = 'Install Codex with `npm install -g @openai/codex` (or set CODEX_PATH), then reload.';

// -----------------------------------------------------------------------------
// Running the Codex CLI
// -----------------------------------------------------------------------------

const isWindows = process.platform === 'win32';

function quoteForCmd(arg: string): string {
  return /[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

/** Codex's environment: inherited, minus API keys, so it uses its own (ChatGPT) sign-in. */
function codexEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return env;
}

function spawnCodex(args: string[]): ChildProcess {
  const command = process.env.CODEX_PATH || 'codex';
  // npm installs `codex` as a .cmd shim on Windows, and those only run through a shell.
  if (isWindows) return spawn([command, ...args].map(quoteForCmd).join(' '), { shell: true, env: codexEnv(), windowsHide: true });
  return spawn(command, args, { env: codexEnv() });
}

function stopProcess(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (isWindows && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGTERM');
}

interface Finished {
  code: number | null;
  output: string;
  /** Set when the program couldn't start at all (e.g. not installed). */
  spawnError: NodeJS.ErrnoException | null;
}

function runCodex(args: string[], timeoutMs = 15_000): Promise<Finished> {
  return new Promise((resolve) => {
    let output = '';
    let child: ChildProcess;
    try {
      child = spawnCodex(args);
    } catch (err) {
      resolve({ code: null, output: '', spawnError: err as NodeJS.ErrnoException });
      return;
    }
    const timer = setTimeout(() => stopProcess(child), timeoutMs);
    child.stdout?.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (output += d.toString()));
    child.once('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, output, spawnError: err as NodeJS.ErrnoException });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output, spawnError: null });
    });
  });
}

/** On Windows a missing command comes back from the shell as exit code 1 with "is not recognized". */
function notInstalled(r: Finished): boolean {
  return r.spawnError?.code === 'ENOENT' || /is not recognized as an internal or external command|command not found/i.test(r.output);
}

export function parseAuth(output: string): CodexAuth {
  if (/not logged in/i.test(output)) return 'none';
  if (/chatgpt/i.test(output)) return 'chatgpt';
  if (/api key/i.test(output)) return 'apikey';
  return 'none';
}

/** Arguments for one structured, read-only, throwaway Codex run. The prompt comes on stdin. */
export function execArgs(o: { cwd: string; schemaFile: string; model: string; reasoningEffort: string }): string[] {
  return [
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--cd',
    o.cwd,
    '--model',
    o.model,
    // Bare words: Codex takes a value that isn't valid TOML as a plain string (no quoting trouble on Windows).
    '--config',
    `model_reasoning_effort=${o.reasoningEffort}`,
    '--config',
    'web_search=disabled',
    '--config',
    'approval_policy=never',
    '--output-schema',
    o.schemaFile,
    '-',
  ];
}

/** Codex is a coding agent; this frames Amble's request so it answers with the JSON only. */
export function codexPrompt(req: Pick<CodexRunRequest, 'system' | 'user'>): string {
  return [
    req.system,
    '---',
    req.user,
    '---',
    'Reply with only the JSON object that the output schema describes. Everything you need is above, so do not run commands or read or edit files.',
  ].join('\n\n');
}

/**
 * Turns one line of `codex exec --json` output into what the browser needs to hear, if anything.
 * Like the Codex SDK, only `turn.failed` is fatal: `error` events can be retries Codex recovers from.
 */
export function readCodexEvent(line: string): CodexRunEvent | { type: 'message'; text: string } | { type: 'note'; message: string } | null {
  let ev: { type?: string; item?: { type?: string; text?: string; message?: string }; error?: { message?: string }; message?: string };
  try {
    ev = JSON.parse(line);
  } catch {
    return null;
  }
  switch (ev.type) {
    case 'turn.started':
      return { type: 'progress', phase: 'thinking' };
    case 'item.started':
      return ev.item?.type === 'command_execution' || ev.item?.type === 'file_change' ? { type: 'progress', phase: 'working' } : { type: 'progress', phase: 'thinking' };
    case 'item.completed':
      return ev.item?.type === 'agent_message' && typeof ev.item.text === 'string' ? { type: 'message', text: ev.item.text } : null;
    case 'turn.failed':
      return { type: 'error', message: ev.error?.message || 'Codex could not finish the request.' };
    case 'error':
      return ev.message ? { type: 'note', message: ev.message } : null;
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

let version: string | null = null;

interface LoginState {
  child: ChildProcess;
  url: string | null;
  error: string | null;
  done: boolean;
}
let login: LoginState | null = null;

async function status(): Promise<CodexStatus> {
  if (!version) {
    const v = await runCodex(['--version']);
    if (notInstalled(v) || v.code !== 0) return { installed: false, version: null, auth: 'none', login: loginInfo() };
    version = v.output.trim().split(/\s+/).pop() ?? v.output.trim();
  }
  const s = await runCodex(['login', 'status']);
  if (notInstalled(s)) {
    version = null;
    return { installed: false, version: null, auth: 'none', login: loginInfo() };
  }
  return { installed: true, version, auth: parseAuth(s.output), login: loginInfo() };
}

function loginInfo(): CodexStatus['login'] {
  return { pending: Boolean(login && !login.done), url: login?.url ?? null, error: login?.error ?? null };
}

/** The sign-in link Codex prints (only once the whole line has arrived). */
const SIGN_IN_URL = /https:\/\/auth\.openai\.com\/\S+(?=\s)/;

/** Starts `codex login`: Codex opens the ChatGPT sign-in page and waits for it on localhost:1455. */
function startLogin(): Promise<CodexStatus['login']> {
  if (login && !login.done) return Promise.resolve(loginInfo());
  let child: ChildProcess;
  try {
    child = spawnCodex(['login']);
  } catch (err) {
    login = null;
    return Promise.resolve({ pending: false, url: null, error: (err as Error).message });
  }
  const state: LoginState = { child, url: null, error: null, done: false };
  login = state;
  let output = '';
  const timer = setTimeout(() => stopProcess(child), RUN_TIMEOUT_MS);
  return new Promise((resolve) => {
    let answered = false;
    const answer = () => {
      if (answered) return;
      answered = true;
      resolve(loginInfo());
    };
    const onData = (d: Buffer) => {
      output += d.toString();
      const m = SIGN_IN_URL.exec(output);
      if (m && !state.url) {
        state.url = m[0];
        answer();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', (err) => {
      state.done = true;
      state.error = (err as NodeJS.ErrnoException).code === 'ENOENT' ? INSTALL_HINT : err.message;
      clearTimeout(timer);
      answer();
    });
    child.once('close', (code) => {
      state.done = true;
      clearTimeout(timer);
      if (code !== 0 && !state.error) state.error = lastLines(output) || `codex login stopped (exit code ${code}).`;
      answer();
    });
    // Codex prints the sign-in link right away; don't hang the request if it doesn't.
    setTimeout(answer, 8000);
  });
}

function lastLines(text: string, max = 400): string {
  const t = text.replace(/\u001b\[[0-9;]*m/g, '').trim();
  return t.length > max ? `…${t.slice(-max)}` : t;
}

// -----------------------------------------------------------------------------
// One structured request
// -----------------------------------------------------------------------------

async function run(req: CodexRunRequest, send: (ev: CodexRunEvent) => void, signal: AbortSignal): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amble-codex-'));
  const cwd = path.join(dir, 'work');
  const schemaFile = path.join(dir, 'schema.json');
  try {
    await mkdir(cwd);
    await writeFile(schemaFile, JSON.stringify(req.schema));
    const child = spawnCodex(execArgs({ cwd, schemaFile, model: req.model, reasoningEffort: req.reasoningEffort }));
    const stop = () => stopProcess(child);
    signal.addEventListener('abort', stop);
    const timer = setTimeout(stop, RUN_TIMEOUT_MS);

    let stderr = '';
    let buffer = '';
    let message: string | null = null;
    let failure: string | null = null;
    let note: string | null = null;
    const onLine = (line: string) => {
      const ev = readCodexEvent(line.trim());
      if (!ev) return;
      if (ev.type === 'message') message = ev.text;
      else if (ev.type === 'error') failure ??= ev.message;
      else if (ev.type === 'note') note = ev.message;
      else send(ev);
    };
    child.stdout?.on('data', (d: Buffer) => {
      buffer += d.toString();
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        onLine(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
      }
    });
    child.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
    child.stdin?.on('error', () => {});
    child.stdin?.end(codexPrompt(req));

    const exit = await new Promise<{ code: number | null; err: NodeJS.ErrnoException | null }>((resolve) => {
      child.once('error', (err) => resolve({ code: null, err: err as NodeJS.ErrnoException }));
      child.once('close', (code) => resolve({ code, err: null }));
    });
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
    if (buffer.trim()) onLine(buffer);
    if (signal.aborted) return;

    if (exit.err?.code === 'ENOENT' || /is not recognized as an internal or external command/i.test(stderr)) {
      send({ type: 'error', message: `Codex isn't installed. ${INSTALL_HINT}` });
    } else if (message !== null && !failure) {
      send({ type: 'result', text: message });
    } else {
      const detail = failure ?? note ?? (lastLines(stderr) || `Codex stopped (exit code ${exit.code}).`);
      send({ type: 'error', message: /not logged in|login|401|unauthorized/i.test(detail) ? `Codex isn't signed in (${detail}). Sign in with ChatGPT again.` : `Codex: ${detail}` });
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// -----------------------------------------------------------------------------
// HTTP
// -----------------------------------------------------------------------------

/** Vite's `allowedHosts` for the dev or preview server (`true` = any host). */
export type AllowedHosts = readonly string[] | true;

export function allowedHostsOf(options: { allowedHosts?: string[] | true; host?: string | boolean }): AllowedHosts {
  if (options.allowedHosts === true) return true;
  return [...(options.allowedHosts ?? []), ...(typeof options.host === 'string' && options.host ? [options.host] : [])];
}

/**
 * The same Host check Vite does against DNS rebinding (IP addresses, localhost, and `allowedHosts`).
 * Plugin middleware runs before Vite's own check, so the AI endpoints repeat it.
 */
export function isAllowedHost(hostHeader: string | undefined, allowed: AllowedHosts): boolean {
  if (allowed === true || hostHeader === undefined) return true;
  const host = hostHeader.trim();
  if (host.startsWith('[')) return host.includes(']') && net.isIP(host.slice(1, host.indexOf(']'))) === 6;
  const name = host.replace(/:\d+$/, '');
  if (net.isIP(name) || name === 'localhost' || name.endsWith('.localhost')) return true;
  return allowed.some((a) => a === name || (a.startsWith('.') && (a.slice(1) === name || name.endsWith(a))));
}

/** Only Amble's own page may use the dev server's AI endpoints (not other sites in your browser). */
export function isSameOrigin(req: IncomingMessage, allowed: AllowedHosts): boolean {
  if (!isAllowedHost(req.headers.host, allowed)) return false;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  if (req.method === 'POST' && !String(req.headers['content-type'] ?? '').includes('application/json')) return false;
  return true;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}') as T;
}

export const codexBridge = (allowed: AllowedHosts): Connect.NextHandleFunction => (req, res, next) => {
  const url = (req.url ?? '').split('?')[0];
  if (!url.startsWith('/api/codex/')) {
    next();
    return;
  }
  if (!isSameOrigin(req, allowed)) {
    sendJson(res, 403, { error: { message: 'Not allowed.' } });
    return;
  }
  void (async () => {
    try {
      if (url === '/api/codex/status' && req.method === 'GET') {
        sendJson(res, 200, await status());
      } else if (url === '/api/codex/login' && req.method === 'POST') {
        await startLogin();
        sendJson(res, 200, await status());
      } else if (url === '/api/codex/login/cancel' && req.method === 'POST') {
        if (login && !login.done) stopProcess(login.child);
        login = null;
        sendJson(res, 200, await status());
      } else if (url === '/api/codex/run' && req.method === 'POST') {
        const body = await readJson<Partial<CodexRunRequest>>(req);
        const effort = String(body.reasoningEffort || 'low');
        // Model and effort become command-line arguments, so only plain names are accepted.
        if (typeof body.system !== 'string' || typeof body.user !== 'string' || !body.schema || typeof body.model !== 'string' || !/^[\w.:/-]{1,80}$/.test(body.model) || !/^[a-z]{1,20}$/.test(effort)) {
          sendJson(res, 400, { error: { message: 'Expected { system, user, schema, model, reasoningEffort }.' } });
          return;
        }
        const controller = new AbortController();
        res.on('close', () => {
          if (!res.writableFinished) controller.abort();
        });
        res.statusCode = 200;
        res.setHeader('content-type', 'application/x-ndjson');
        res.setHeader('cache-control', 'no-store');
        res.flushHeaders();
        await run(
          { system: body.system, user: body.user, schema: body.schema, model: body.model, reasoningEffort: effort },
          (ev) => {
            if (!res.destroyed) res.write(`${JSON.stringify(ev)}\n`);
          },
          controller.signal,
        );
        res.end();
      } else {
        sendJson(res, 404, { error: { message: 'Unknown Codex endpoint.' } });
      }
    } catch (err) {
      if (res.headersSent) res.end(`${JSON.stringify({ type: 'error', message: (err as Error).message })}\n`);
      else sendJson(res, 500, { error: { message: (err as Error).message } });
    }
  })();
};
