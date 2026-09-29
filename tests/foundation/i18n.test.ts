/**
 * The string tables (§1.3, §8.3 step 4): every referenced key exists, student strings are at most 160
 * characters (`page_` keys, the in-app pages, may be longer), and none of the banned words appears in a
 * student-facing string (`staff_` keys are for teachers and IT; `legacy_` keys may name the old editor).
 */
import { describe, expect, it } from 'vitest';
import { format, lookup, midSentence, t, TABLES } from '../../src/i18n';

const SOURCES = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

const BANNED = ['sprite', 'stage', 'costume', 'backdrop', 'block', 'blocks', 'script', 'compile', 'green flag', 'asset', 'placeholder', 'rig'];

/** Whole words, with an optional plural "s" ("sprites", "assets", "rigs"). */
const BANNED_RE = new RegExp(`\\b(${BANNED.map((w) => w.replace(/ /g, '\\s+')).join('|')})s?\\b`, 'i');

const ENTRIES = Object.entries(TABLES).flatMap(([ns, table]) => Object.entries(table as Record<string, string>).map(([key, text]) => ({ ns, key, text, id: `${ns}.${key}` })));

const namespaces = Object.keys(TABLES).join('|');

describe('i18n', () => {
  it('merges every module table', () => {
    expect(Object.keys(TABLES).sort()).toEqual(['ai', 'bones', 'common', 'draw', 'files', 'history', 'home', 'school', 'starters', 'world']);
  });

  it('has every key the code references', () => {
    // Literal keys in t() calls (keys typed as MessageKey elsewhere are checked by the compiler).
    const literal = new RegExp(`\\bt\\(\\s*['"\`]((?:${namespaces})\\.[A-Za-z_][A-Za-z0-9_]*)['"\`]`, 'g');
    const cores = ['/src/i18n/', '/src/ai/', '/src/play/', '/src/rig/', '/src/art/', '/src/runtime/'];
    const missing: string[] = [];
    let seen = 0;
    for (const [path, text] of Object.entries(SOURCES)) {
      if (cores.some((c) => path.startsWith(c))) continue;
      seen += [...text.matchAll(literal)].length;
      for (const m of text.matchAll(literal)) if (lookup(m[1]) === undefined) missing.push(`${path}: ${m[1]}`);
    }
    expect(seen).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });

  it('keeps student strings to 160 characters (pages may be longer)', () => {
    const long = ENTRIES.filter((e) => !e.key.startsWith('page_') && e.text.length > 160).map((e) => `${e.id} (${e.text.length})`);
    expect(long).toEqual([]);
  });

  it('never uses a banned word in student copy', () => {
    const bad = ENTRIES.filter((e) => !e.key.startsWith('staff_') && !e.key.startsWith('legacy_') && BANNED_RE.test(e.text)).map((e) => `${e.id}: ${e.text}`);
    expect(bad).toEqual([]);
  });

  it('the banned-word check catches the words', () => {
    for (const w of ['Pick a sprite', 'the Stage', 'Assets', 'drag blocks', 'green  flag', 'the rig']) expect(BANNED_RE.test(w)).toBe(true);
    for (const w of ['blocked by the filter', 'right', 'staged', 'scripted? no: descriptive']) expect(BANNED_RE.test(w)).toBe(false);
  });

  it('keeps strings single-line and trimmed', () => {
    const bad = ENTRIES.filter((e) => e.text !== e.text.trim() || (/\n/.test(e.text) && !e.key.startsWith('page_'))).map((e) => e.id);
    expect(bad).toEqual([]);
  });

  it('fills placeholders and falls back to the key', () => {
    expect(format('{n} of {max}', { n: 2, max: 6 })).toBe('2 of 6');
    expect(format('Hi {name}', {})).toBe('Hi {name}');
    expect(t('common.counter', { n: 1, max: 3 })).toBe('1 of 3');
    expect(lookup('common.nope')).toBeUndefined();
    expect(lookup('nope')).toBeUndefined();
  });

  it('puts a name with "The" inside a sentence in lower case', () => {
    expect(t('draw.drawingTitle', { name: midSentence('The Moon King') })).toBe('Drawing the Moon King');
    expect(t('draw.youDrew', { name: midSentence('The Moon King') })).toBe('You drew the Moon King');
    expect(midSentence('Pip')).toBe('Pip');
    expect(midSentence('Theo')).toBe('Theo');
    expect(midSentence('The')).toBe('The');
    expect(midSentence('Star shard')).toBe('Star shard');
  });
});
