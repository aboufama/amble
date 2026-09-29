/**
 * File names (§4.6): `<title>.amble`, or `<title> - <initials>.amble` from Hand in. Names are cleaned
 * for every file system a school might use (ChromeOS, Drive, Windows): no slashes, no reserved
 * characters, no trailing dots or spaces, never empty.
 */

const RESERVED = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g;

/** A safe base name (no extension) from anything a student typed. */
export function safeBaseName(text: string, fallback = 'My world'): string {
  const clean = text
    .normalize('NFC')
    .replace(RESERVED, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim();
  return clean || fallback;
}

/** "Moon King.amble", "Moon King - J.R.amble". */
export function worldFileName(title: string, initials?: string): string {
  const base = safeBaseName(title);
  const who = initials ? safeBaseName(initials, '') : '';
  return who ? `${base} - ${who}.amble` : `${base}.amble`;
}

export function withExtension(name: string, ext: string): string {
  const base = safeBaseName(name.replace(/\.[A-Za-z0-9]{1,8}$/, ''));
  return `${base}.${ext}`;
}

/** Unique names inside one zip: "Moon King.amble", "Moon King (2).amble". */
export function uniqueName(name: string, taken: Set<string>): string {
  const lower = (s: string) => s.toLowerCase();
  if (!taken.has(lower(name))) {
    taken.add(lower(name));
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const next = `${base} (${n})${ext}`;
    if (!taken.has(lower(next))) {
      taken.add(lower(next));
      return next;
    }
  }
}

/** The title a file name suggests ("Moon King - J.R.amble" → "Moon King - J.R"). */
export function titleFromFileName(name: string): string {
  return name.replace(/\.amble$/i, '').trim().slice(0, 40) || 'My world';
}
