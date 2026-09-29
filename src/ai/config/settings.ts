/**
 * Manual AI settings: for home or hobby use in the public build. Stored in localStorage; the key
 * moves to sessionStorage when "Remember on this device" is off. Old Amble's `amble:settings`
 * (key, base URL, models) is read once when there are no new settings yet.
 */
import * as F from './fields';
import { DEFAULT_AI_SETTINGS, type AiSettings, type ConfigLayer } from './types';

const KEY = 'amble:ai-settings';
const SESSION_KEY = 'amble:ai-key';
const OLD_KEY = 'amble:settings';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SettingsStores {
  local: KeyValue | null;
  session?: KeyValue | null;
}

function read(store: KeyValue | null | undefined, key: string): Record<string, unknown> | null {
  try {
    const raw: unknown = JSON.parse(store?.getItem(key) ?? 'null');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function clean(o: Record<string, unknown>): AiSettings {
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
  const b = (k: keyof AiSettings) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : (DEFAULT_AI_SETTINGS[k] as boolean));
  return {
    apiKey: s('apiKey'),
    baseUrl: s('baseUrl').replace(/\/+$/, ''),
    model: s('model'),
    fastModel: s('fastModel'),
    visionModel: s('visionModel'),
    visionAllowed: b('visionAllowed'),
    ageBand: F.band(o.ageBand) ?? null,
    safetyIdentifier: b('safetyIdentifier'),
    enabled: b('enabled'),
    rememberKey: b('rememberKey'),
    useChatGpt: b('useChatGpt'),
  };
}

/** The old editor's settings, mapped: `assetModel` becomes the fast model; art settings are dropped. */
function migrate(old: Record<string, unknown>): AiSettings {
  return clean({
    apiKey: old.apiKey,
    baseUrl: old.baseUrl === OPENAI_BASE_URL ? '' : old.baseUrl,
    model: old.model === 'gpt-5' ? '' : old.model,
    fastModel: old.assetModel === 'gpt-5-mini' ? '' : old.assetModel,
    useChatGpt: old.useChatGpt,
  });
}

export function loadAiSettings(stores: SettingsStores): AiSettings {
  const saved = read(stores.local, KEY);
  const settings = saved ? clean(saved) : (() => {
    const old = read(stores.local, OLD_KEY);
    return old ? migrate(old) : { ...DEFAULT_AI_SETTINGS };
  })();
  if (!settings.rememberKey) {
    const session = stores.session?.getItem(SESSION_KEY);
    settings.apiKey = typeof session === 'string' ? session : '';
  }
  return settings;
}

export function saveAiSettings(settings: AiSettings, stores: SettingsStores): void {
  const { apiKey, ...rest } = clean({ ...settings });
  if (settings.rememberKey) {
    stores.local?.setItem(KEY, JSON.stringify({ ...rest, apiKey }));
    stores.session?.removeItem(SESSION_KEY);
  } else {
    stores.local?.setItem(KEY, JSON.stringify({ ...rest, apiKey: '' }));
    if (apiKey) stores.session?.setItem(SESSION_KEY, apiKey);
    else stores.session?.removeItem(SESSION_KEY);
  }
}

/** Forgets the manual settings, key included ("Delete all Amble data" and "Disconnect"). */
export function clearAiSettings(stores: SettingsStores): void {
  stores.local?.removeItem(KEY);
  stores.session?.removeItem(SESSION_KEY);
}

export function layerFromSettings(settings: AiSettings | null): ConfigLayer | null {
  if (!settings) return null;
  const layer: ConfigLayer = {
    source: 'manual',
    enabled: settings.enabled,
    visionAllowed: settings.visionAllowed,
    ageBand: settings.ageBand ?? undefined,
    safetyIdentifier: settings.safetyIdentifier,
    model: settings.model || undefined,
    fastModel: settings.fastModel || undefined,
    visionModel: settings.visionModel || undefined,
    problems: [],
  };
  const key = settings.apiKey.trim();
  if (settings.baseUrl) {
    const url = F.baseUrl(settings.baseUrl);
    if (url && 'problem' in url) layer.problems?.push(url.problem);
    if (url && 'url' in url) layer.baseUrl = url.url;
  } else if (key) {
    layer.baseUrl = OPENAI_BASE_URL;
  }
  if (layer.baseUrl) layer.auth = key ? { type: 'bearer', key } : { type: 'none' };
  return layer;
}
