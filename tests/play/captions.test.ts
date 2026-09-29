/**
 * Captions for game sounds (§6.7, §3.9): each caption shows for about 2.5 s, two lines at most, the oldest
 * dropping first; a sound that repeats keeps one line up; and a shared web page carries the Captions setting.
 */
import { describe, expect, it } from 'vitest';
import { CAPTION_LINES, CAPTION_MS, CaptionQueue } from '../../src/play/captions';
import { STANDALONE_DATA_ID } from '../../src/play/protocol';
import { buildStandaloneHtml } from '../../src/play/standalone';

const texts = (q: CaptionQueue, now: number) => q.lines(now).map((l) => l.text);

describe('the caption queue', () => {
  it('shows a caption for about 2.5 s', () => {
    const q = new CaptionQueue();
    expect(CAPTION_MS).toBe(2500);
    q.push('[boss roars]', 1000);
    expect(texts(q, 1000)).toEqual(['[boss roars]']);
    expect(texts(q, 3499)).toEqual(['[boss roars]']);
    expect(texts(q, 3500)).toEqual([]);
    expect(q.nextChange()).toBeNull();
  });

  it('keeps two lines at most, and drops the oldest for a new one', () => {
    const q = new CaptionQueue();
    expect(CAPTION_LINES).toBe(2);
    q.push('[boing]', 0);
    q.push('[pew]', 100);
    expect(texts(q, 100)).toEqual(['[boing]', '[pew]']);
    q.push('[boom]', 200);
    expect(texts(q, 200)).toEqual(['[pew]', '[boom]']);
    // Each still goes at its own time: the older first.
    expect(q.nextChange()).toBe(2600);
    expect(texts(q, 2600)).toEqual(['[boom]']);
    expect(texts(q, 2700)).toEqual([]);
  });

  it('keeps one line up for a sound that plays again, as the newest', () => {
    const q = new CaptionQueue();
    const first = q.push('[pew]', 0)[0];
    q.push('[boing]', 500);
    const again = q.push('[pew]', 2000);
    expect(again.map((l) => l.text)).toEqual(['[boing]', '[pew]']);
    // The same line (the view keeps its element), shown 2.5 s from the repeat.
    expect(again[1].id).toBe(first.id);
    expect(texts(q, 4000)).toEqual(['[pew]']);
    expect(texts(q, 4500)).toEqual([]);
  });

  it('tidies the words, ignores empty ones, and changes its list only when the lines change', () => {
    const q = new CaptionQueue();
    q.push('  [chime\n  rings]  ', 0);
    expect(texts(q, 0)).toEqual(['[chime rings]']);
    expect(q.push('   ', 10).length).toBe(1);
    expect(q.push('x'.repeat(200), 20)[1].text).toHaveLength(80);
    const a = q.lines(30);
    expect(q.lines(40)).toBe(a);
    expect(q.clear()).toEqual([]);
    expect(q.nextChange()).toBeNull();
  });
});

describe('a shared web page', () => {
  const page = (captions?: boolean) => buildStandaloneHtml({ title: 'Chime', runtime: '', files: [{ name: 'game.js', source: '' }], captions });
  const game = (html: string) => JSON.parse(new RegExp(`<script type="application/json" id="${STANDALONE_DATA_ID}">([\\s\\S]*?)</script>`).exec(html)?.[1] ?? 'null') as { captions?: boolean };

  it('shows captions when whoever shared it had Captions on', async () => {
    expect(game(await page(true)).captions).toBe(true);
    expect(game(await page(false)).captions).toBeUndefined();
    expect(game(await page()).captions).toBeUndefined();
  });
});
