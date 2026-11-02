/**
 * Amble's server side: `/api/config` (what this server offers) and `/api/openai/*`, a proxy to
 * OpenAI that adds the server's OPENAI_API_KEY, so the key never reaches the browser and visitors
 * can build blocks written in words with no account.
 *
 * On Vercel this file is the function behind both paths (see vercel.json: they are rewritten to
 * /api/amble). The dev and preview servers (vite.config.ts) call the same handler.
 *
 * A hosted proxy spends the owner's money for anyone who opens the site, so in hosted mode it only
 * answers Amble's own page (same origin), only for Amble's three endpoints, only with the models
 * Amble uses, with a cap on output tokens and a per-visitor rate limit. None of that stops someone
 * determined to spoof a browser: also set a monthly budget on the key's OpenAI project.
 *
 * Self-contained on purpose (no local imports), so Vercel can bundle it as it is.
 */

export interface AmbleApiOptions {
  /** OPENAI_API_KEY. Empty: the proxy answers 401 and /api/config says there's no key. */
  key: string;
  /** OpenAI or any OpenAI-compatible endpoint. */
  baseUrl: string;
  /** Hosted (public) mode: the guards below apply. Off for the dev server on your computer. */
  hosted: boolean;
  /** Models the proxy accepts (hosted mode). Dated snapshots of these are accepted too. */
  allowedModels: string[];
  /** Image models the proxy accepts (hosted mode). */
  allowedImageModels: string[];
  /** Cap on generated tokens (reasoning included) per request, hosted mode. */
  maxOutputTokens: number;
  /** Largest request body, in bytes. */
  maxBodyBytes: number;
  /** Requests per visitor (by IP) per window, hosted mode; 0 turns it off. Per server instance. */
  rateLimit: number;
  rateWindowMs: number;
  /** The "Sign in with ChatGPT" bridge is there (dev server only). */
  codex: boolean;
  /** For tests. */
  fetch?: typeof fetch;
  now?: () => number;
}

const MODELS = ['gpt-6.1-terra', 'gpt-6-luna'];
const IMAGE_MODELS = ['gpt-image-2.5-flare'];

const list = (v: string | undefined, fallback: string[]) => {
  const items = (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
};
const int = (v: string | undefined, fallback: number) => (v && /^\d+$/.test(v.trim()) ? Number(v.trim()) : fallback);

/** Hosted options from the environment (Vercel → Project → Settings → Environment Variables). */
export function hostedOptions(env: Record<string, string | undefined>): AmbleApiOptions {
  return {
    key: (env.OPENAI_API_KEY ?? '').trim(),
    baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    hosted: true,
    allowedModels: list(env.AMBLE_MODELS, MODELS),
    allowedImageModels: list(env.AMBLE_IMAGE_MODELS, IMAGE_MODELS),
    maxOutputTokens: int(env.AMBLE_MAX_OUTPUT_TOKENS, 64_000),
    maxBodyBytes: 2_000_000,
    rateLimit: int(env.AMBLE_RATE_LIMIT, 120),
    rateWindowMs: 10 * 60_000,
    codex: false,
  };
}

/** Options for the dev/preview server on your computer: your own key, any model, no limits. */
export function devOptions(env: Record<string, string | undefined>): AmbleApiOptions {
  return { ...hostedOptions(env), hosted: false, maxBodyBytes: 20_000_000, rateLimit: 0, codex: true };
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
}

const fail = (status: number, message: string, code?: string) => json(status, { error: { message, ...(code ? { code } : {}) } });

/** The request came from Amble's own page (not another site, and in hosted mode, from a browser). */
export function isOwnPage(request: Request): boolean {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  // Browsers send Sec-Fetch-Site on every request, and Origin on every POST.
  return Boolean(site || origin);
}

const hits = new Map<string, number[]>();

function rateLimited(request: Request, opts: AmbleApiOptions): boolean {
  if (!opts.hosted || opts.rateLimit <= 0) return false;
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  const now = (opts.now ?? Date.now)();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < opts.rateWindowMs);
  if (hits.size > 5000) hits.clear();
  if (recent.length >= opts.rateLimit) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

/** For tests: forget the rate limit's history. */
export function resetRateLimit(): void {
  hits.clear();
}

function modelAllowed(model: unknown, allowed: string[]): boolean {
  if (typeof model !== 'string') return false;
  return allowed.some((m) => model === m || (model.startsWith(`${m}-`) && /^\d{4}-\d{2}-\d{2}$/.test(model.slice(m.length + 1))));
}

const CHAT_KEYS = ['model', 'messages', 'response_format', 'stream', 'stream_options', 'reasoning_effort', 'max_completion_tokens'];
const IMAGE_KEYS = ['model', 'prompt', 'size', 'quality', 'output_format', 'background', 'response_format'];
const IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536'];

function pick(body: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
}

/**
 * Hosted mode: keeps only what Amble sends, and checks it. Returns the body to send upstream,
 * or a Response explaining why not.
 */
function guardBody(path: string, body: Record<string, unknown>, opts: AmbleApiOptions): Record<string, unknown> | Response {
  if (path === 'chat/completions') {
    if (!modelAllowed(body.model, opts.allowedModels)) {
      return fail(403, `This site builds with ${opts.allowedModels.join(' or ')}. To use ${String(body.model)}, add your own OpenAI API key in Settings.`, 'amble_model_not_allowed');
    }
    const out = pick(body, CHAT_KEYS);
    const asked = Number(out.max_completion_tokens);
    out.max_completion_tokens = Number.isFinite(asked) && asked > 0 ? Math.min(asked, opts.maxOutputTokens) : opts.maxOutputTokens;
    return out;
  }
  if (path === 'images/generations') {
    if (!modelAllowed(body.model, opts.allowedImageModels)) {
      return fail(403, `This site draws with ${opts.allowedImageModels.join(' or ')}. To use ${String(body.model)}, add your own OpenAI API key in Settings.`, 'amble_model_not_allowed');
    }
    const out = pick(body, IMAGE_KEYS);
    out.n = 1;
    if (!IMAGE_SIZES.includes(String(out.size))) out.size = '1024x1024';
    if (out.quality !== undefined && !['low', 'medium', 'auto'].includes(String(out.quality))) out.quality = 'medium';
    return out;
  }
  return body;
}

const ENDPOINTS: Record<string, 'GET' | 'POST'> = { 'chat/completions': 'POST', 'images/generations': 'POST', models: 'GET' };

async function proxy(request: Request, path: string, opts: AmbleApiOptions): Promise<Response> {
  const method = ENDPOINTS[path];
  if (opts.hosted && !method) return fail(404, `Unknown endpoint: ${path}`);
  if (opts.hosted && request.method !== method) return fail(405, `Use ${method} for ${path}.`);
  if (!opts.key) return fail(401, 'OPENAI_API_KEY is not set on the server.');
  if (opts.hosted && !isOwnPage(request)) return fail(403, 'Not allowed.');
  if (request.method === 'POST' && !(request.headers.get('content-type') ?? '').includes('application/json')) return fail(415, 'Send JSON.');
  if (rateLimited(request, opts)) return fail(429, 'Lots of builds from here in the last few minutes. Wait a little, then try again (or add your own OpenAI API key in Settings).', 'amble_rate_limit');

  let body: string | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.text();
    if (body.length > opts.maxBodyBytes) return fail(413, 'The request is too big.');
    if (opts.hosted) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return fail(400, 'Send JSON.');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail(400, 'Send a JSON object.');
      const guarded = guardBody(path, parsed as Record<string, unknown>, opts);
      if (guarded instanceof Response) return guarded;
      body = JSON.stringify(guarded);
    }
  }

  let upstream: Response;
  try {
    upstream = await (opts.fetch ?? fetch)(`${opts.baseUrl}/${path}`, {
      method: request.method,
      headers: { 'content-type': request.headers.get('content-type') ?? 'application/json', authorization: `Bearer ${opts.key}` },
      body,
      signal: request.signal,
    });
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return fail(502, `Proxy error: ${(err as Error).message}`);
  }

  // The hosted model list shows only the models this site builds with.
  if (opts.hosted && path === 'models' && upstream.ok) {
    const data = (await upstream.json()) as { data?: Array<{ id: string }> };
    const allowed = [...opts.allowedModels, ...opts.allowedImageModels];
    return json(200, { object: 'list', data: (data.data ?? []).filter((m) => modelAllowed(m.id, allowed)) });
  }

  const headers = new Headers();
  upstream.headers.forEach((value, name) => {
    // fetch already decoded the body; cookies and OpenAI's org details stay upstream.
    if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie', 'openai-organization', 'openai-project'].includes(name)) headers.set(name, value);
  });
  headers.set('cache-control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers });
}

/** Which Amble endpoint a request is for: from the rewrite's query (Vercel) or from the path. */
export function routeOf(request: Request): { kind: 'config' } | { kind: 'openai'; path: string } | null {
  const url = new URL(request.url);
  const route = url.searchParams.get('route');
  if (route === 'config' || url.pathname === '/api/config') return { kind: 'config' };
  let path = url.searchParams.get('path');
  if (path === null && url.pathname.startsWith('/api/openai/')) path = url.pathname.slice('/api/openai/'.length);
  if (route !== 'openai' && path === null) return null;
  path = (path ?? '').replace(/^\/+|\/+$/g, '');
  if (!path || path.split('/').some((seg) => !/^[\w.-]+$/.test(seg) || seg === '..' || seg === '.')) return { kind: 'openai', path: '' };
  return { kind: 'openai', path };
}

export async function handleAmbleApi(request: Request, opts: AmbleApiOptions): Promise<Response> {
  const route = routeOf(request);
  if (!route) return fail(404, 'Not found.');
  if (route.kind === 'config') {
    return json(200, {
      serverKey: Boolean(opts.key),
      codex: opts.codex,
      hosted: opts.hosted,
      models: opts.hosted ? opts.allowedModels : null,
    });
  }
  if (!route.path) return fail(404, 'Unknown endpoint.');
  return proxy(request, route.path, opts);
}

// The Vercel function (Web standard `fetch` export, Node.js runtime).
export default {
  fetch(request: Request): Promise<Response> {
    return handleAmbleApi(request, hostedOptions(process.env));
  },
};
