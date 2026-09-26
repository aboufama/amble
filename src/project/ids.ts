/** Short random ids for sprites and assets. */
export function uid(prefix = ''): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

/** FNV-1a 32-bit hash as hex (fast, stable; used to detect uncompiled changes). */
export function hashString(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Makes `name` unique among `taken` by appending a number ("costume2", "Sprite 3"). */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(name)) return name;
  const base = name.replace(/\s*\d+$/, '') || name;
  const spaced = /\s\d+$/.test(name) || /\s/.test(base);
  for (let i = 2; ; i++) {
    const candidate = spaced ? `${base} ${i}` : `${base}${i}`;
    if (!set.has(candidate)) return candidate;
  }
}
