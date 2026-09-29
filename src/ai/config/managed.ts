/**
 * ChromeOS Managed Configuration: an admin force-installs the Amble PWA and pushes a JSON config
 * for its origin (`ManagedConfigurationPerOrigin`). Students never see a setting. The API exists
 * only for force-installed apps on managed devices, so it is feature-detected. Shape:
 *
 *   { "amble": 1,
 *     "district": { "name": "SAU 99", "privacyUrl": "https://…", "contact": "tech@sau99.org" },
 *     "ai": { "enabled": true, "baseUrl": "https://amble-ai.sau99.org/v1", "model": "amble-default",
 *             "fastModel": "", "visionModel": "", "auth": { "type": "class-code", "header": "X-Amble-Class", "code": "" },
 *             "moderation": "endpoint", "capabilities": ["json_schema"], "allowArtToAI": false,
 *             "safetyIdentifier": true, "requestsMayBeReviewed": false, "gradeBandsWithAI": ["middle", "high"] },
 *     "content": { "max": "middle", "default": "middle" },
 *     "devices": { "shared": true },
 *     "lock": ["ai", "content"] }
 *
 * The same object may also sit under a top-level "amble" key.
 */
import * as F from './fields';
import type { ConfigLayer } from './types';

const KEYS = ['amble', 'district', 'ai', 'content', 'devices', 'lock', 'schoolMode'];

interface ManagedData {
  getManagedConfiguration(keys: string[]): Promise<Record<string, unknown>>;
  addEventListener?(type: 'managedconfigurationchange', listener: () => void): void;
  removeEventListener?(type: 'managedconfigurationchange', listener: () => void): void;
}

function managedApi(nav: unknown): ManagedData | null {
  const managed = nav && typeof nav === 'object' ? (nav as { managed?: unknown }).managed : undefined;
  return managed && typeof (managed as ManagedData).getManagedConfiguration === 'function' ? (managed as ManagedData) : null;
}

/** Reads the managed configuration, or null where there is none (every unmanaged device). */
export async function readManagedConfig(nav: unknown = globalThis.navigator, timeoutMs = 2000): Promise<Record<string, unknown> | null> {
  const api = managedApi(nav);
  if (!api) return null;
  try {
    const result = await Promise.race([
      api.getManagedConfiguration(KEYS),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!result || typeof result !== 'object') return null;
    const nested = (result as Record<string, unknown>).amble;
    const root = nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : result;
    return Object.keys(root).length ? root : null;
  } catch {
    return null;
  }
}

/** Calls `listener` when the admin changes the configuration; returns an unsubscribe function. */
export function onManagedConfigChange(listener: () => void, nav: unknown = globalThis.navigator): () => void {
  const api = managedApi(nav);
  if (!api?.addEventListener) return () => {};
  api.addEventListener('managedconfigurationchange', listener);
  return () => api.removeEventListener?.('managedconfigurationchange', listener);
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function layerFromManaged(raw: Record<string, unknown> | null): ConfigLayer | null {
  if (!raw) return null;
  const problems: string[] = [];
  const ai = obj(raw.ai);
  const content = obj(raw.content);
  // A managed device is a school device.
  const layer: ConfigLayer = { source: 'managed', schoolMode: F.bool(raw.schoolMode) ?? true, problems };
  layer.enabled = F.bool(ai.enabled);
  const url = F.baseUrl(ai.baseUrl);
  if (url && 'problem' in url) problems.push(`ai.baseUrl: ${url.problem}`);
  if (url && 'url' in url) {
    layer.baseUrl = url.url;
    const auth = obj(ai.auth);
    const type = F.str(auth.type)?.toLowerCase() ?? 'none';
    if (type === 'class-code') {
      const header = F.headerName(auth.header) ?? F.DEFAULT_CLASS_HEADER;
      const code = F.code(auth.code);
      if (code) layer.auth = { type: 'class-code', header, code };
      else layer.classCodeHeader = header;
    } else if (type === 'none') {
      layer.auth = { type: 'none' };
    } else {
      problems.push(`ai.auth.type "${type}" isn't supported for school devices (use "none" or "class-code"); keys belong on the proxy.`);
      layer.auth = { type: 'none' };
    }
  }
  layer.model = F.str(ai.model, 120);
  layer.fastModel = F.str(ai.fastModel, 120);
  layer.visionModel = F.str(ai.visionModel, 120);
  layer.caps = F.caps(ai.capabilities);
  layer.moderation = F.moderation(ai.moderation);
  layer.visionAllowed = F.artToAi(ai.allowArtToAI ?? ai.visionAllowed);
  layer.safetyIdentifier = F.bool(ai.safetyIdentifier);
  layer.requestsMayBeReviewed = F.bool(ai.requestsMayBeReviewed);
  layer.aiBands = F.bands(ai.gradeBandsWithAI);
  layer.ageBandMax = F.band(content.max);
  layer.ageBand = F.band(content.default);
  layer.sharedDevice = F.bool(obj(raw.devices).shared);
  layer.lock = F.locks(raw.lock);
  layer.district = F.district(raw.district);
  return layer;
}
