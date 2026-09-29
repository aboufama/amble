/**
 * The art barrel in a real browser (§8.2): `createArtSurface` from src/cores/art.ts mounts the engine's
 * surface, the spec's names work (`setSize`, `size`, `tool`, `canUndo`, `penup`, `doc`), `inked()`
 * follows real pen strokes and undo, and the saved doc exports.
 */
import { expect, openAmble, test } from '../helpers/app';
import { stroke } from '../helpers/pen';

type Win = typeof window & {
  __artTest: {
    events: string[];
    inked(): number;
    call(name: string, ...args: unknown[]): unknown;
  };
};

test('the art barrel drives the engine surface with the spec names', async ({ page }) => {
  await openAmble(page);
  await page.evaluate(async () => {
    const host = document.createElement('div');
    host.id = 'art-test';
    host.style.cssText = 'position:fixed;left:40px;top:40px;width:600px;height:600px;z-index:999';
    document.body.append(host);
    const art = await import(/* @vite-ignore */ `${location.origin}/src/cores/art.ts`);
    const doc = art.newArtDoc({ name: 'Test', kind: 'character', rig: 'blob', width: 512, height: 512 });
    const surface = art.createArtSurface(host, doc, { pressure: 'normal', worker: false });
    await surface.ready;
    const events: string[] = [];
    surface.on('penup', () => events.push('penup'));
    surface.on('inked', () => events.push('inked'));
    surface.on('history', () => events.push('history'));
    (window as Win).__artTest = {
      events,
      inked: () => surface.inked(),
      call: (name, ...args) => (surface as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
    };
  });
  const api = (name: string, ...args: unknown[]) => page.evaluate(([n, a]) => (window as Win).__artTest.call(n as string, ...(a as unknown[])), [name, args] as const);

  expect(await api('tool')).toBe('ink');
  await api('setSize', 12);
  expect(await api('size')).toBe(12);
  expect(await api('canUndo')).toBe(false);
  expect(await page.evaluate(() => (window as Win).__artTest.inked())).toBe(0);

  const host = page.locator('#art-test');
  const zig: Array<[number, number]> = [];
  for (let i = 0; i <= 40; i++) zig.push([150 + i * 7, 200 + (i % 2) * 160]);
  await stroke(page, host, zig, { pointer: 'pen', hz: 240 });

  await expect.poll(() => page.evaluate(() => (window as Win).__artTest.inked())).toBeGreaterThan(0.005);
  expect(await api('canUndo')).toBe(true);
  const events = await page.evaluate(() => (window as Win).__artTest.events);
  expect(events).toContain('penup');
  expect(events).toContain('inked');

  await page.evaluate(() => (window as Win).__artTest.call('undo'));
  await expect.poll(() => page.evaluate(() => (window as Win).__artTest.inked())).toBe(0);
  await page.evaluate(() => (window as Win).__artTest.call('redo'));
  await expect.poll(() => page.evaluate(() => (window as Win).__artTest.inked())).toBeGreaterThan(0.005);

  const exported = await page.evaluate(async () => {
    const art = await import(/* @vite-ignore */ `${location.origin}/src/cores/art.ts`);
    const doc = await ((window as Win).__artTest.call('doc') as Promise<unknown>);
    const out = await art.exportArt(doc, { maxSide: 256 });
    (window as Win).__artTest.call('destroy');
    return out ? { w: out.flat.w, h: out.flat.h, hasMask: out.linesMask !== null, cels: (doc as { cels: unknown[] }).cels.length } : null;
  });
  expect(exported).not.toBeNull();
  expect(Math.max(exported!.w, exported!.h)).toBeLessThanOrEqual(256);
  expect(exported!.hasMask).toBe(true);
  expect(exported!.cels).toBeGreaterThan(0);
});
