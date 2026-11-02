/**
 * Debug spend tracking: every compile, art and sound request adds its token usage, priced at
 * OpenAI's standard rates, to a running total kept in this browser (localStorage). It is an
 * estimate for development, not a bill: prices are hard-coded below (November 2026), requests
 * stopped partway report no usage, and ChatGPT sign-in runs on the ChatGPT plan (no API cost).
 */
import { create } from 'zustand';

/** Show the spend counter in the menu bar. Debug only for now: set to false to hide it. */
export const SPEND_DEBUG = true;

/** US dollars per 1M tokens. */
export interface Price {
  input: number;
  cachedInput: number;
  /** Prompt tokens written to the prompt cache (1.25x input when OpenAI doesn't list it). */
  cacheWrite?: number;
  output: number;
  /** Image models: image tokens (in the prompt and generated). Text output doesn't apply. */
  imageInput?: number;
  imageOutput?: number;
}

/**
 * Standard-tier prices from developers.openai.com/api/docs/pricing (checked 2 November 2026).
 * Model ids match by prefix, so dated snapshots ("gpt-6.1-terra-2026-10-26") use their family's price.
 */
export const PRICES: Record<string, Price> = {
  'gpt-6.1-terra': { input: 1, cachedInput: 0.05, cacheWrite: 1.25, output: 5 },
  'gpt-6-luna': { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
  'gpt-6.1-sol': { input: 2, cachedInput: 0.1, output: 10 },
  'gpt-6-sol': { input: 2, cachedInput: 0.2, output: 10 },
  'gpt-6-astra': { input: 10, cachedInput: 1, output: 50 },
  'gpt-image-2.5-flare': { input: 5, cachedInput: 1.25, output: 0, imageInput: 8, imageOutput: 30 },
  'gpt-image-2.5-sunburst': { input: 5, cachedInput: 1.25, output: 0, imageInput: 8, imageOutput: 30 },
  'gpt-image-2': { input: 5, cachedInput: 1.25, output: 0, imageInput: 8, imageOutput: 30 },
  'gpt-image-1.5': { input: 5, cachedInput: 1.25, output: 10, imageInput: 8, imageOutput: 32 },
  'gpt-image-1-mini': { input: 2, cachedInput: 0.2, output: 0, imageInput: 2.5, imageOutput: 8 },
};

/** Prompts longer than this are billed at 2x input (and cache) and 1.5x output for the whole request. */
const LONG_CONTEXT = 272_000;

export function priceOf(model: string): Price | null {
  const id = model.trim().toLowerCase();
  let best: string | null = null;
  for (const key of Object.keys(PRICES)) {
    if ((id === key || id.startsWith(`${key}-`)) && (!best || key.length > best.length)) best = key;
  }
  return best ? PRICES[best] : null;
}

/** The `usage` of a Chat Completions reply. */
export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number | null; cache_write_tokens?: number | null } | null;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
}

/** The `usage` of an Images API reply. */
export interface ImageUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number | null; image_tokens?: number | null; cached_tokens?: number | null } | null;
}

export interface Tokens {
  /** Prompt tokens, cached ones included. */
  input: number;
  cached: number;
  cacheWrite: number;
  /** Generated tokens, reasoning included. */
  output: number;
  reasoning: number;
  /** Image models: image tokens in the prompt. */
  imageInput: number;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export function chatTokens(u: ChatUsage): Tokens {
  const input = n(u.prompt_tokens);
  const cached = Math.min(input, n(u.prompt_tokens_details?.cached_tokens));
  return {
    input,
    cached,
    cacheWrite: Math.min(input - cached, n(u.prompt_tokens_details?.cache_write_tokens)),
    output: n(u.completion_tokens),
    reasoning: n(u.completion_tokens_details?.reasoning_tokens),
    imageInput: 0,
  };
}

export function imageTokens(u: ImageUsage): Tokens {
  const input = n(u.input_tokens);
  return { input, cached: Math.min(input, n(u.input_tokens_details?.cached_tokens)), cacheWrite: 0, output: n(u.output_tokens), reasoning: 0, imageInput: Math.min(input, n(u.input_tokens_details?.image_tokens)) };
}

/** What a request cost in US dollars, or null when the model's price isn't known. */
export function costOf(model: string, t: Tokens): number | null {
  const p = priceOf(model);
  if (!p) return null;
  const long = t.input > LONG_CONTEXT;
  const inMul = long ? 2 : 1;
  const outMul = long ? 1.5 : 1;
  const isImage = p.imageOutput !== undefined;
  const uncached = Math.max(0, t.input - t.cached - t.cacheWrite);
  // Image models: prompt image tokens and every generated token are image tokens.
  const textIn = isImage ? Math.max(0, uncached - t.imageInput) : uncached;
  const imageIn = isImage ? Math.min(uncached, t.imageInput) : 0;
  const usd =
    (textIn * p.input + imageIn * (p.imageInput ?? p.input) + t.cached * p.cachedInput + t.cacheWrite * (p.cacheWrite ?? p.input * 1.25)) * inMul +
    t.output * (isImage ? (p.imageOutput ?? 0) : p.output) * outMul;
  return usd / 1_000_000;
}

// -----------------------------------------------------------------------------
// The running total
// -----------------------------------------------------------------------------

export type SpendKind = 'code' | 'art' | 'sound' | 'image';

export interface ModelSpend {
  calls: number;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  usd: number;
  /** Calls with no price for the model, or that ran on the ChatGPT plan. */
  unpriced: number;
  /** Calls stopped (or failed) before OpenAI reported their usage: their cost is missing. */
  incomplete: number;
}

export interface SpendState {
  since: number;
  byModel: Record<string, ModelSpend>;
  last: { model: string; kind: SpendKind; usd: number | null; tokens: Tokens | null; at: number } | null;
}

const KEY = 'amble:spend';

function empty(): SpendState {
  return { since: Date.now(), byModel: {}, last: null };
}

function load(): SpendState {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as SpendState;
      if (s && typeof s.since === 'number' && s.byModel && typeof s.byModel === 'object') return { ...empty(), ...s };
    }
  } catch {
    /* ignore */
  }
  return empty();
}

function save(s: SpendState): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export const useSpend = create<SpendState>(() => load());

function add(model: string, kind: SpendKind, tokens: Tokens | null, usd: number | null, flags: { unpriced?: boolean; incomplete?: boolean }): void {
  useSpend.setState((s) => {
    const prev = s.byModel[model] ?? { calls: 0, input: 0, cached: 0, output: 0, reasoning: 0, usd: 0, unpriced: 0, incomplete: 0 };
    const next: ModelSpend = {
      calls: prev.calls + 1,
      input: prev.input + (tokens?.input ?? 0),
      cached: prev.cached + (tokens?.cached ?? 0),
      output: prev.output + (tokens?.output ?? 0),
      reasoning: prev.reasoning + (tokens?.reasoning ?? 0),
      usd: prev.usd + (usd ?? 0),
      unpriced: prev.unpriced + (flags.unpriced ? 1 : 0),
      incomplete: prev.incomplete + (flags.incomplete ? 1 : 0),
    };
    const state: SpendState = { ...s, byModel: { ...s.byModel, [model]: next }, last: { model, kind, usd, tokens, at: Date.now() } };
    save(state);
    return state;
  });
}

/** A finished request, with the usage OpenAI reported (null when it reported none). */
export function recordUsage(model: string, kind: SpendKind, tokens: Tokens | null): void {
  if (!tokens) {
    add(model, kind, null, null, { incomplete: true });
    return;
  }
  const usd = costOf(model, tokens);
  add(model, kind, tokens, usd, { unpriced: usd === null });
}

/** A request on the ChatGPT plan (through Codex): no API cost, and no token counts. */
export function recordPlanCall(model: string, kind: SpendKind): void {
  add(`${model} (ChatGPT plan)`, kind, null, 0, { unpriced: true });
}

export function resetSpend(): void {
  const s = empty();
  save(s);
  useSpend.setState(s, true);
}

export function totalUsd(s: SpendState): number {
  return Object.values(s.byModel).reduce((sum, m) => sum + m.usd, 0);
}

export function totalCalls(s: SpendState): number {
  return Object.values(s.byModel).reduce((sum, m) => sum + m.calls, 0);
}

/** "$0.0042", "$1.27": more digits for small amounts. */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
