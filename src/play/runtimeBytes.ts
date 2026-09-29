/**
 * The runtime file (Phaser + Amble runtime), fetched ONCE by the editor: same-origin, HTTP-cached and
 * service-worker-cached. Each player iframe gets a copy of the bytes (an opaque-origin frame never
 * HTTP-caches what it fetches itself, so it must not fetch).
 */

const cache = new Map<string, Promise<ArrayBuffer>>();

export function loadRuntime(url: string): Promise<ArrayBuffer> {
  let bytes = cache.get(url);
  if (!bytes) {
    bytes = fetch(url, { credentials: 'same-origin' }).then(async (r) => {
      if (!r.ok) throw new Error(`Amble could not load its game engine (${r.status}). Check the connection and reload.`);
      return r.arrayBuffer();
    });
    bytes.catch(() => cache.delete(url));
    cache.set(url, bytes);
  }
  return bytes;
}

/** The runtime as text (for the standalone export). */
export async function loadRuntimeText(url: string): Promise<string> {
  return new TextDecoder().decode(await loadRuntime(url));
}
