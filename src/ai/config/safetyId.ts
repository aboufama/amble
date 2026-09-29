/**
 * The `safety_identifier` sent with AI requests when the config enables it. Providers use it to
 * block one abusive user instead of a whole school's account. It is a salted SHA-256 of a random id
 * made on this device, rotated daily, so it can't be linked to a student, across endpoints, or over
 * time. It never contains a name.
 */

const DEVICE_KEY = 'amble:device-id';
let memoryId: string | null = null;

type KeyValue = Pick<Storage, 'getItem' | 'setItem'>;

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(buf);
  else for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A random id for this device, made once and kept in storage (or memory when storage is blocked). */
export function deviceId(storage: KeyValue | null): string {
  try {
    const saved = storage?.getItem(DEVICE_KEY);
    if (saved && /^[0-9a-f]{32}$/.test(saved)) return saved;
    const id = randomHex(16);
    storage?.setItem(DEVICE_KEY, id);
    if (storage) return id;
  } catch {
    // Storage blocked: an id for this session only.
  }
  memoryId ??= randomHex(16);
  return memoryId;
}

function day(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * `amble_` + 40 hex digits of SHA-256(salt, device id, UTC day). Null where Web Crypto isn't
 * available (insecure contexts), in which case nothing is sent.
 */
export async function safetyIdentifier(o: { salt: string; storage: KeyValue | null; now?: Date }): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const input = new TextEncoder().encode(`amble-safety-v1|${o.salt}|${deviceId(o.storage)}|${day(o.now ?? new Date())}`);
  const digest = new Uint8Array(await subtle.digest('SHA-256', input));
  return `amble_${Array.from(digest.slice(0, 20), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
