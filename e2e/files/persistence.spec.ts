/**
 * Nothing is ever lost (§1.5 law 4, §4.3-4.4, §4.7): a reload keeps the world; a drawing's draft
 * survives a page closed mid-drawing and brings the student back to it; the old Amble's autosave comes in
 * through the card and stays untouched; with storage blocked, Amble runs from memory and says so.
 */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { injectHarness, openStarter } from './m6';

test('a reload keeps the world, in IndexedDB', async ({ page }) => {
  await openAmble(page, { clean: true });
  expect(await page.evaluate(() => (window as unknown as { __amble: { store: { mode: string } } }).__amble.store.mode)).toBe('idb');
  const id = await openStarter(page);
  await page.reload();
  await expect(page.getByTestId('screen-world')).toBeVisible();
  expect(page.url()).toContain(`#/w/${id}`);
  const ids = await page.evaluate(async () => (await (window as unknown as { __amble: { store: { worlds: { list(): Promise<Array<{ id: string }>> } } } }).__amble.store.worlds.list()).map((m) => m.id));
  expect(ids).toEqual([id]);
});

test('a draft survives a page closed mid-drawing, and brings the student back to it', async ({ page, context }) => {
  await openAmble(page, { clean: true });
  await page.evaluate(async () => {
    const store = (window as unknown as { __amble: { store: { drafts: { put(d: unknown): Promise<void> } } } }).__amble.store;
    const cel = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' });
    await store.drafts.put({ artId: 'a_draftlost1', worldId: null, castKey: null, doc: '{"layers":[]}', cels: { lines: cel }, tool: 'ink', at: Date.now() });
  });
  await page.close();

  const again = await context.newPage();
  await again.goto('./');
  await expect(again).toHaveURL(/#\/draw\/a_draftlost1$/);
  await expect(again.getByTestId('toasts').getByText('Welcome back. Your drawing is safe.')).toBeVisible();
  const draft = await again.evaluate(async () => {
    const store = (window as unknown as { __amble: { store: { drafts: { get(id: string): Promise<{ cels: Record<string, Blob> } | null> } } } }).__amble.store;
    const d = await store.drafts.get('a_draftlost1');
    return d ? [...new Uint8Array(await d.cels.lines.arrayBuffer())] : null;
  });
  expect(draft).toEqual([137, 80, 78, 71, 1, 2, 3]);
  // Once shown, the next visit goes where the student asks.
  await again.goto('./#/trail');
  await expect(again.getByTestId('screen-trail')).toBeVisible();
  await again.reload();
  await expect(again).toHaveURL(/#\/trail$/);
  await again.close();
});

test('the old Amble card brings its drawings and sounds, and the old save stays as it was', async ({ page }) => {
  await openAmble(page, { clean: true });
  const oldSave = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(48, 52);
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#ff9f43';
    g.fillRect(8, 8, 32, 40);
    const png = await canvas.convertToBlob({ type: 'image/png' });
    const pngUrl = await new Promise<string>((r) => {
      const fr = new FileReader();
      fr.onload = () => r(String(fr.result));
      fr.readAsDataURL(png);
    });
    const svgUrl = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#2b3a67"/><circle cx="400" cy="60" r="30" fill="#fff3a8"/></svg>')}`;
    const wav = new Uint8Array(44 + 200);
    const v = new DataView(wav.buffer);
    [...'RIFF'].forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
    v.setUint32(4, 36 + 200, true);
    [...'WAVEfmt '].forEach((c, i) => v.setUint8(8 + i, c.charCodeAt(0)));
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 22050, true);
    v.setUint32(28, 44100, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    [...'data'].forEach((c, i) => v.setUint8(36 + i, c.charCodeAt(0)));
    v.setUint32(40, 200, true);
    const wavUrl = `data:audio/wav;base64,${btoa(String.fromCharCode(...wav))}`;
    const target = (name: string, costumes: unknown[], sounds: unknown[]) => ({ id: `t-${name}`, kind: 'sprite', name, description: '', costumes, sounds, currentCostume: 0, blocks: {}, x: 0, y: 0, z: 0, size: 100, direction: 0, visible: true, rotationStyle: 'left-right' });
    const project = {
      format: 'amble',
      version: 1,
      id: 'p-1',
      title: 'Cat Quest',
      notes: 'A cat collects coins.',
      mode: '2d',
      stage: { id: 't-stage', kind: 'stage', name: 'Stage', description: '', costumes: [{ id: 'bg', name: 'night', kind: 'image', dataUrl: svgUrl, mime: 'image/svg+xml', width: 480, height: 360, resolution: 1, centerX: 240, centerY: 180 }], sounds: [], currentCostume: 0, blocks: null },
      sprites: [target('Cat', [{ id: 'c1', name: 'cat', kind: 'image', dataUrl: pngUrl, mime: 'image/png', width: 48, height: 52, resolution: 2, centerX: 24, centerY: 50 }], [{ id: 's1', name: 'meow', kind: 'sound', dataUrl: wavUrl, mime: 'audio/wav', duration: 0.01 }])],
      compiled: {},
    };
    // The old editor's autosave: idb-keyval's default database and store.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('keyval-store', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('keyval');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction('keyval', 'readwrite');
        tx.objectStore('keyval').put(project, 'amble:project');
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
    });
    return JSON.stringify(project);
  });
  await page.reload();
  await gotoRoute(page, '#/trail');
  await injectHarness(page);
  const card = page.getByTestId('m6-dock').getByRole('region', { name: 'Cat Quest' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('We found a game from the old Amble: Cat Quest. Bring its drawings and sounds here?');
  await expect(card).toContainText('2 drawings and 1 sound');
  await card.getByTestId('legacy-bring').click();
  await expect(page.getByTestId('toasts').getByText("We brought in your drawings and sounds. The blocks don't come along; your drawings are in a new world called Cat Quest (old).")).toBeVisible();
  await expect(card).toBeHidden();

  const result = await page.evaluate(async () => {
    const a = (window as unknown as { __amble: { store: { worlds: { list(): Promise<Array<{ id: string; title: string }>>; get(id: string): Promise<{ cast: Record<string, { art: string | null }>; sounds: Record<string, unknown> } | null> }; art: { list(): Promise<Array<{ name: string; kind: string; board: { w: number; h: number }; export: { flat: string } | null }>> }; blobs: { get(r: string): Promise<Blob | null> }; settings: { get(k: string): Promise<unknown> } } } }).__amble;
    const metas = await a.store.worlds.list();
    const world = await a.store.worlds.get(metas[0].id);
    const art = await a.store.art.list();
    const flats = await Promise.all(art.map(async (x) => (x.export ? ((await a.store.blobs.get(x.export.flat))?.type ?? null) : null)));
    const old = await new Promise<unknown>((resolve) => {
      const req = indexedDB.open('keyval-store');
      req.onsuccess = () => {
        const get = req.result.transaction('keyval').objectStore('keyval').get('amble:project');
        get.onsuccess = () => {
          req.result.close();
          resolve(get.result);
        };
      };
    });
    return { titles: metas.map((m) => m.title), drawn: Object.values(world!.cast).filter((s) => s.art).length, sounds: Object.keys(world!.sounds), art: art.map((x) => ({ name: x.name, kind: x.kind, w: x.board.w })), flats, legacy: await a.store.settings.get('legacy'), old: JSON.stringify(old) };
  });
  expect(result.titles).toEqual(['Cat Quest (old)']);
  expect(result.drawn).toBe(2);
  expect(result.sounds).toEqual(['meow']);
  expect(result.art.sort((x, y) => x.name.localeCompare(y.name))).toEqual([
    { name: 'cat', kind: 'character', w: 48 },
    { name: 'night', kind: 'background', w: 960 },
  ]);
  expect(result.flats).toEqual(['image/png', 'image/png']);
  expect(result.legacy).toMatchObject({ choice: 'brought' });
  expect(result.old).toBe(oldSave);
});

test('with storage blocked, Amble keeps work in memory and says so', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException('Blocked by policy', 'SecurityError');
      },
    });
  });
  await openAmble(page);
  expect(await page.evaluate(() => (window as unknown as { __amble: { store: { mode: string } } }).__amble.store.mode)).toBe('memory');
  await openStarter(page);
  await injectHarness(page);
  const dock = page.getByTestId('m6-dock');
  await expect(dock.getByTestId('storage-banner')).toContainText("This browser isn't letting Amble save here. Your work will only be kept in files you save.");
  await expect(dock.getByTestId('save-state')).toHaveText('Only saved in files');
  await dock.getByRole('button', { name: 'Why?' }).click();
  await expect(page.getByRole('dialog', { name: "Why Amble can't save here" })).toBeVisible();
});
