/**
 * Source guards (§10.1): the architecture rules every module keeps, checked on the source text.
 * - Phaser and the in-iframe runtime (`src/runtime/**`) are imported only by the runtime itself.
 * - Modules reach the cores only through the `src/cores/*.ts` barrels.
 * - `fetch(` appears only in `src/ai/**`, `src/app/player/**`, `src/starters/**`, `src/pwa/**` and the
 *   player core `src/play/**` (an addition: its runtime loader), and outside `src/ai/**` never with an
 *   absolute URL. No other network door (XHR, WebSocket, EventSource, sendBeacon) exists outside src/ai.
 * - No native dialogs (`alert`, `confirm`, `prompt`).
 */
import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

/** Source text without comments (strings are kept; good enough for these scans). */
function code(text: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    out += ch;
    i++;
  }
  return out;
}

const FILES = Object.entries(SOURCES).map(([path, text]) => ({ path: path.replace(/^\//, ''), text, code: code(text) }));

/** Every module specifier a file imports (static, dynamic and side-effect imports, and re-exports). */
function specifiers(src: string): string[] {
  const out: string[] = [];
  const patterns = [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\bimport\s+['"]([^'"]+)['"]/g];
  for (const re of patterns) for (const m of src.matchAll(re)) out.push(m[1]);
  return out;
}

/** A relative specifier resolved against the importing file (`src/app/x.ts` + `../ai` → `src/ai`). */
function resolve(from: string, spec: string): string {
  if (!spec.startsWith('.')) return spec;
  const parts = from.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

const under = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

describe('source guards', () => {
  it('finds the sources', () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.some((f) => f.path === 'src/main.tsx')).toBe(true);
  });

  it('imports Phaser and src/runtime only from inside src/runtime', () => {
    const bad: string[] = [];
    for (const f of FILES) {
      if (under(f.path, 'src/runtime')) continue;
      for (const spec of specifiers(f.code)) {
        const target = resolve(f.path, spec);
        if (spec === 'phaser' || spec.startsWith('phaser/') || under(target, 'src/runtime')) bad.push(`${f.path} → ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('reaches the cores only through src/cores/*.ts', () => {
    // src/runtime is the in-iframe half of the player core (it imports src/play/protocol and the rig's mesh).
    const cores = ['src/ai', 'src/rig', 'src/play', 'src/art/engine', 'src/runtime'];
    const bad: string[] = [];
    for (const f of FILES) {
      if (under(f.path, 'src/cores') || cores.some((c) => under(f.path, c))) continue;
      for (const spec of specifiers(f.code)) {
        const target = resolve(f.path, spec);
        if (cores.some((c) => under(target, c))) bad.push(`${f.path} → ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('calls fetch only where the spec allows it, and never with an absolute URL outside src/ai', () => {
    const allowed = ['src/ai', 'src/app/player', 'src/starters', 'src/pwa', 'src/play'];
    const bad: string[] = [];
    for (const f of FILES) {
      const calls = [...f.code.matchAll(/(?<![\w$.])fetch\s*\(\s*([^,)]*)/g)];
      if (!calls.length) continue;
      if (!allowed.some((d) => under(f.path, d))) {
        bad.push(`${f.path}: fetch outside the allowed folders`);
        continue;
      }
      if (under(f.path, 'src/ai')) continue;
      for (const [, arg] of calls) if (/^\s*[`'"](https?:)?\/\//i.test(arg)) bad.push(`${f.path}: fetch(${arg.trim()})`);
    }
    expect(bad).toEqual([]);
  });

  it('opens no other network door outside src/ai', () => {
    const bad: string[] = [];
    for (const f of FILES) {
      if (under(f.path, 'src/ai') || under(f.path, 'src/runtime')) continue;
      if (/\bnew\s+(XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection)\b|\bsendBeacon\s*\(/.test(f.code)) bad.push(f.path);
    }
    expect(bad).toEqual([]);
  });

  it('never uses native dialogs', () => {
    const bad = FILES.filter((f) => !under(f.path, 'src/runtime') && /(?:^|[^\w$.])(?:window\.)?(?:alert|confirm|prompt)\s*\(/m.test(f.code)).map((f) => f.path);
    expect(bad).toEqual([]);
  });

  it('has no stubs left', () => {
    // Every module has landed: nothing may throw or catch "not built yet" any more.
    const stubbed = FILES.filter((f) => /\bNotBuiltYet\b/.test(f.text)).map((f) => f.path);
    expect(stubbed).toEqual([]);
  });
});
