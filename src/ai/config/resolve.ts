/**
 * The browser entry points for AI configuration: read every source, merge, and turn the result
 * into a Transport. The UI calls `resolveAiConfig()` at start, after a class link is connected or
 * disconnected, after Settings change, and when the managed configuration changes.
 */
import type { AuthKind } from '../errors';
import { CODEX_BASE_URL, CODEX_MODEL, CODEX_MODEL_NAME, devServerInfo, type DevServerInfo } from '../transport/codex';
import { originOf } from '../transport/fetch';
import type { Transport } from '../transport/types';
import { layerFromClassLink, loadClassLink, readClassLink, type ClassLinkRead } from './classLink';
import { layerFromEnv } from './env';
import { layerFromManaged, readManagedConfig } from './managed';
import { mergeLayers } from './merge';
import { safetyIdentifier } from './safetyId';
import { layerFromSettings, loadAiSettings } from './settings';
import type { AiConfig, ConfigLayer } from './types';

type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(name: 'localStorage' | 'sessionStorage'): KeyValue | null {
  try {
    return globalThis[name] ?? null;
  } catch {
    return null;
  }
}

export interface ResolveOptions {
  /** Build variables; default `import.meta.env`. */
  env?: Record<string, unknown>;
  /** The managed configuration; default read from `navigator.managed`. */
  managed?: Record<string, unknown> | null;
  local?: KeyValue | null;
  session?: KeyValue | null;
  /** Running on the dev server; default `import.meta.env.DEV`. Production builds never offer the dev sources. */
  dev?: boolean;
  /** What the dev server offers; default asked from `/api/config` (dev only). */
  devServer?: DevServerInfo | null;
  now?: Date;
}

/** Reads every source and merges them (precedence and locks in merge.ts). */
export async function resolveAiConfig(o: ResolveOptions = {}): Promise<AiConfig> {
  const env = o.env ?? (import.meta.env as Record<string, unknown>);
  const local = o.local !== undefined ? o.local : browserStorage('localStorage');
  const session = o.session !== undefined ? o.session : browserStorage('sessionStorage');
  const managed = layerFromManaged(o.managed !== undefined ? o.managed : await readManagedConfig());
  const build = layerFromEnv(env);
  const link = layerFromClassLink(loadClassLink(local));
  const settings = loadAiSettings({ local, session });
  let manual = layerFromSettings(settings);
  let dev: ConfigLayer | null = null;
  const schoolMode = managed?.schoolMode === true || build?.schoolMode === true;
  if ((o.dev ?? Boolean(import.meta.env?.DEV)) && !schoolMode) {
    const info = o.devServer !== undefined ? o.devServer : await devServerInfo();
    if (info?.codex && settings.useChatGpt) {
      dev = { source: 'dev', via: 'codex', baseUrl: CODEX_BASE_URL, model: CODEX_MODEL, fastModel: CODEX_MODEL, visionModel: CODEX_MODEL, visionAllowed: settings.visionAllowed, caps: { stream: false, jsonSchema: true, reasoning: true, images: true, moderation: false } };
      // Choosing "Sign in with ChatGPT" beats a key typed earlier.
      if (manual) manual = { ...manual, baseUrl: undefined, auth: undefined };
    } else if (info?.serverKey) {
      dev = { source: 'dev', via: 'dev-server', baseUrl: '/api/openai', model: settings.model || undefined, fastModel: settings.fastModel || undefined, visionAllowed: settings.visionAllowed };
    }
  }
  return mergeLayers([managed, build, link, manual, dev], o.now);
}

/** A class link waiting in the address bar, for the "Connect to your class's AI helper?" card. */
export function pendingClassLink(loc: Pick<Location, 'hash'> = window.location): ClassLinkRead | null {
  return readClassLink(loc.hash);
}

/** Can AI requests be made with this config? */
export function aiAvailable(config: AiConfig): boolean {
  return config.enabled && config.baseUrl !== '';
}

export type ModelRole = 'main' | 'fast' | 'vision';

export function modelFor(config: AiConfig, role: ModelRole): string {
  return role === 'fast' ? config.fastModel : role === 'vision' ? config.visionModel : config.model;
}

function hostOf(baseUrl: string): string {
  if (baseUrl.startsWith('/')) return 'this computer';
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export interface AiSourceDescription {
  /** The first line of the status chip: "Your school set this up". */
  title: string;
  /** The second line: "AI helper on · amble-ai.sau99.org · Room 12". */
  detail: string;
  /** The endpoint's host, when there is one. */
  host: string | null;
  /** A school or teacher chose these settings; Settings shows them read-only. */
  managedBySchool: boolean;
}

/** Words for the AI status chip and Settings. */
export function describeAiSource(config: AiConfig): AiSourceDescription {
  const host = config.baseUrl ? hostOf(config.baseUrl) : null;
  const managedBySchool = config.source === 'managed' || config.source === 'build' || config.source === 'class-link';
  const titles: Record<AiConfig['source'], string> = {
    managed: 'Your school set this up',
    build: 'Your school set this up',
    'class-link': 'Your teacher set this up',
    manual: 'You set this up on this device',
    dev: config.via === 'codex' ? `Your ChatGPT sign-in (${CODEX_MODEL_NAME}, this computer only)` : "This computer's dev server",
    none: config.offReason === 'expired' ? 'Your class link has expired' : 'The AI helper is off',
  };
  let detail: string;
  if (config.enabled) {
    detail = ['AI helper on', host, config.classLabel, config.district?.name].filter(Boolean).join(' · ');
  } else {
    const off: Record<NonNullable<AiConfig['offReason']>, string> = {
      'not-configured': 'You can still draw, tune your game and change its code.',
      'turned-off': config.offBy === 'manual' ? 'You turned the AI helper off.' : config.offBy === 'class-link' ? 'Your teacher turned the AI helper off for this class.' : 'Your school turned the AI helper off.',
      expired: 'Ask your teacher for a new class link.',
      'grade-band': 'The AI helper is off for this grade level.',
      'needs-class-link': "Open your teacher's class link to turn it on.",
      'needs-key': 'Add an AI key in Settings to turn it on.',
    };
    detail = off[config.offReason ?? 'not-configured'];
  }
  if (config.requestsMayBeReviewed && config.enabled) detail += ' · Your school may review AI requests.';
  return { title: titles[config.source], detail, host, managedBySchool };
}

export interface TransportOptions {
  fetch?: typeof fetch;
  isOnline?: () => boolean;
  /** Where the device id for the safety identifier lives; default localStorage. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

/** The Transport for a config, or null when AI isn't available. */
export function transportFor(config: AiConfig, o: TransportOptions = {}): Transport | null {
  if (!aiAvailable(config)) return null;
  const headers: Record<string, string> = {};
  let auth: AuthKind = 'none';
  if (config.auth.type === 'bearer') {
    headers.Authorization = `Bearer ${config.auth.key}`;
    auth = 'key';
  } else if (config.auth.type === 'class-code') {
    headers[config.auth.header] = config.auth.code;
    auth = 'class-code';
  }
  if (config.via !== 'endpoint') auth = 'dev';
  const storage = o.storage !== undefined ? o.storage : browserStorage('localStorage');
  const salt = originOf(config.baseUrl) ?? config.baseUrl;
  return {
    baseUrl: config.baseUrl,
    headers,
    via: config.via,
    auth,
    // Pictures go out only where the school (or, at home, the user) allowed them.
    caps: config.visionAllowed ? { ...config.caps } : { ...config.caps, images: false },
    host: hostOf(config.baseUrl),
    safetyIdentifier: config.safetyIdentifier ? () => safetyIdentifier({ salt, storage }) : undefined,
    fetch: o.fetch,
    isOnline: o.isOnline,
  };
}
