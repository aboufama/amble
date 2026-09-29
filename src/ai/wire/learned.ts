/**
 * What endpoints have told us they can't do, remembered on this device so Amble doesn't send them
 * pictures, or ask them to moderate, again and again. Only "no" answers are stored.
 */

type Feature = 'images' | 'moderation';

const KEY = 'amble:ai-endpoint-caps';
let memory: Record<string, Feature[]> | null = null;

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function load(): Record<string, Feature[]> {
  if (memory) return memory;
  memory = {};
  try {
    const raw: unknown = JSON.parse(storage()?.getItem(KEY) ?? '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw)) if (Array.isArray(v)) memory[k] = v.filter((f): f is Feature => f === 'images' || f === 'moderation');
    }
  } catch {
    // Unreadable storage: start fresh.
  }
  return memory;
}

function keyOf(baseUrl: string, feature: Feature, model: string): string {
  return feature === 'images' ? `${baseUrl}#${model}` : baseUrl;
}

/** Has this endpoint (and, for pictures, this model) refused the feature before? */
export function knownUnsupported(baseUrl: string, feature: Feature, model = ''): boolean {
  return load()[keyOf(baseUrl, feature, model)]?.includes(feature) ?? false;
}

export function rememberUnsupported(baseUrl: string, feature: Feature, model = ''): void {
  const all = load();
  const key = keyOf(baseUrl, feature, model);
  if (all[key]?.includes(feature)) return;
  all[key] = [...(all[key] ?? []), feature];
  try {
    storage()?.setItem(KEY, JSON.stringify(all));
  } catch {
    // Remembering is a convenience; memory still has it for this session.
  }
}

/** Forgets everything learned (Settings "Test connection" starts clean). */
export function forgetLearnedCaps(): void {
  memory = {};
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
