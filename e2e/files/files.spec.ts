/**
 * Files (§4.6, §10.2 `files`): Save to Drive through the picker → clear storage → open the file → the
 * same world (code, drawing hashes, dials, footsteps); later saves overwrite the kept file; the download
 * fallback; a read-only (turned-in) copy; dropping a file on the Trail opens it.
 */
import type { Page } from '@playwright/test';
import { cleanProfile, expect, gotoRoute, openAmble, test } from '../helpers/app';
import { clearFiles, fakePickers, injectHarness, openStarter, putFile, savedBytes, worldIdOf } from './m6';

interface WorldLike {
  title: string;
  code: Array<{ path: string; source: string }>;
  dials: Record<string, number>;
  steps: Array<{ kind: string; text: string }>;
  cast: Record<string, { art: string | null }>;
}

/** Gives the open world a drawing (real PNG pixels) as its hero and a dial, then reloads it. */
async function seedDrawing(page: Page, worldId: string): Promise<string> {
  const hash = await page.evaluate(async (id) => {
    const store = (window as unknown as { __amble: { store: { worlds: { get(id: string): Promise<WorldLike | null> }; commit(c: unknown): Promise<void> } } }).__amble.store;
    const canvas = new OffscreenCanvas(64, 80);
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#b388ff';
    g.beginPath();
    g.ellipse(32, 46, 26, 30, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#221b2e';
    g.fillRect(20, 36, 6, 6);
    g.fillRect(38, 36, 6, 6);
    const flat = await canvas.convertToBlob({ type: 'image/png' });
    const sha = async (b: Blob) => `sha256:${[...new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer()))].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
    const celRef = await sha(flat);
    const doc = new Blob(
      [
        JSON.stringify({
          format: 'amble-art',
          v: 1,
          id: 'art1',
          name: 'Blorp',
          kind: 'character',
          width: 64,
          height: 80,
          pixelArt: false,
          layers: [{ id: 'lines', name: 'Lines', role: 'lines', visible: true, locked: false, opacity: 1, blend: 'normal', alphaLock: false }],
          frames: [{ id: 'f1', hold: 1 }],
          cels: [{ frame: 'f1', layer: 'lines', x: 0, y: 0, w: 64, h: 80, ref: celRef }],
          anchor: null,
          palette: ['#b388ff'],
          created: 1,
          updated: 1,
          version: 1,
        }),
      ],
      { type: 'application/json' },
    );
    const now = Date.now();
    const art = {
      id: 'a_e2ehero001',
      name: 'Blorp',
      kind: 'character',
      rig: 'blob',
      facing: 'viewer',
      role: 'hero',
      mode: 'free',
      board: { w: 64, h: 80, pixelArt: false },
      doc: await sha(doc),
      cels: [celRef],
      parts: {},
      export: { hash: celRef.slice(7), flat: celRef, w: 64, h: 80, anchor: [32, 80], inkMask: null, parts: {}, sticker: celRef, thumb: celRef, frames: null },
      rigData: null,
      rigInfo: null,
      palette: ['#b388ff'],
      madeBy: 'student',
      shelf: true,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const world = (await store.worlds.get(id))!;
    world.cast.hero = { ...world.cast.hero, art: art.id };
    world.dials = { ...world.dials, jump: 820 };
    await store.commit({ blobs: [flat, doc], art: [art], worlds: [world] });
    return celRef;
  }, worldId);
  await page.reload();
  await expect(page.getByTestId('screen-world')).toBeVisible();
  return hash;
}

async function worldIn(page: Page, id: string): Promise<WorldLike> {
  return page.evaluate(async (wid) => {
    const store = (window as unknown as { __amble: { store: { worlds: { get(id: string): Promise<unknown> } } } }).__amble.store;
    return (await store.worlds.get(wid)) as WorldLike;
  }, id);
}

async function artFlat(page: Page, artId: string): Promise<string | null> {
  return page.evaluate(async (aid) => {
    const store = (window as unknown as { __amble: { store: { art: { get(id: string): Promise<{ export: { flat: string } | null } | null> } } } }).__amble.store;
    return (await store.art.get(aid))?.export?.flat ?? null;
  }, artId);
}

test.beforeEach(async ({ page }) => {
  await openAmble(page, { clean: true });
});

test('Save to Drive, then open the file after the storage is wiped: the same world', async ({ page }) => {
  await fakePickers(page);
  await page.reload();
  await clearFiles(page);
  const id = await openStarter(page);
  const flat = await seedDrawing(page, id);
  const before = await worldIn(page, id);
  await injectHarness(page);

  await page.getByTestId('m6-dock').getByTestId('save-to-drive').click();
  await expect(page.getByTestId('toasts').getByText('Saved Moon King.amble')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __m6saves: string[] }).__m6saves)).toEqual(['Moon King.amble']);
  const bytes = await savedBytes(page, 'Moon King.amble');
  expect(bytes.slice(0, 4)).toEqual([0x50, 0x4b, 0x03, 0x04]);

  // Ctrl+S saves again to the same file, with no picker.
  const stamp = () =>
    page.evaluate(async () => {
      const d = await navigator.storage.getDirectory();
      return (await (await d.getFileHandle('Moon King.amble')).getFile()).lastModified;
    });
  const first = await stamp();
  await page.waitForTimeout(20);
  await page.keyboard.press('Control+s');
  await expect.poll(stamp).toBeGreaterThan(first);
  expect(await page.evaluate(() => (window as unknown as { __m6saves: string[] }).__m6saves.length)).toBe(1);

  // A cart wiped overnight: nothing left but the file in Drive.
  await cleanProfile(page);
  await openAmble(page);
  expect(await page.evaluate(async () => (await (window as unknown as { __amble: { store: { worlds: { list(): Promise<unknown[]> } } } }).__amble.store.worlds.list()).length)).toBe(0);
  await page.evaluate(() => {
    (window as unknown as { __m6open: string[] }).__m6open = ['Moon King.amble'];
  });
  await gotoRoute(page, '#/trail');
  await injectHarness(page);
  await page.getByTestId('m6-dock').getByTestId('open-file').click();
  await expect(page).toHaveURL(/#\/w\/[A-Za-z0-9_-]+$/);
  const opened = worldIdOf(page);
  expect(opened).not.toBe(id);
  const after = await worldIn(page, opened);
  expect(after.title).toBe(before.title);
  expect(after.code).toEqual(before.code);
  expect(after.dials).toEqual(before.dials);
  expect(after.steps.slice(0, before.steps.length).map((s) => s.text)).toEqual(before.steps.map((s) => s.text));
  expect(after.steps.at(-1)).toMatchObject({ kind: 'import', text: 'You opened Moon King.amble.' });
  const heroArt = after.cast.hero.art!;
  expect(heroArt).not.toBe('a_e2ehero001');
  expect(await artFlat(page, heroArt)).toBe(flat);

  // Opening the same file again goes back to that world (its handle is kept).
  await gotoRoute(page, '#/trail');
  await injectHarness(page);
  await page.getByTestId('m6-dock').getByTestId('open-file').click();
  await expect(page).toHaveURL(new RegExp(`#/w/${opened}$`));
});

test('downloads the file where the picker is missing or blocked', async ({ page }) => {
  await fakePickers(page, { noPicker: true });
  await page.reload();
  await openStarter(page);
  await injectHarness(page);
  const download = page.waitForEvent('download');
  await page.getByTestId('m6-dock').getByTestId('save-to-drive').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Moon King.amble');
  await expect(page.getByTestId('toasts').getByText('It went to your Downloads (or Drive, if your school set it up).')).toBeVisible();
});

test('a read-only copy (turned in) opens as a copy and offers Save my own copy', async ({ page }) => {
  await fakePickers(page);
  await page.reload();
  await clearFiles(page);
  await openStarter(page);
  await injectHarness(page);
  await page.getByTestId('m6-dock').getByTestId('save-to-drive').click();
  await expect(page.getByTestId('toasts').getByText('Saved Moon King.amble')).toBeVisible();
  await putFile(page, 'Moon King - J.R.amble', await savedBytes(page, 'Moon King.amble'));
  await page.evaluate(() => {
    const w = window as unknown as { __m6open: string[]; __m6readOnly: string[] };
    w.__m6open = ['Moon King - J.R.amble'];
    w.__m6readOnly = ['Moon King - J.R.amble'];
  });
  const first = worldIdOf(page);
  await page.getByTestId('m6-dock').getByTestId('open-file').click();
  const dialog = page.getByRole('dialog', { name: 'A read-only copy' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('This copy is read-only (was it turned in?). Save your own copy to keep working.');
  await expect.poll(() => worldIdOf(page)).not.toBe(first);
  await dialog.getByRole('button', { name: 'Save my own copy' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __m6saves: string[] }).__m6saves)).toEqual(['Moon King.amble', 'Moon King.amble']);
  const kept = await page.evaluate(async (wid) => {
    const store = (window as unknown as { __amble: { store: { handles: { get(id: string): Promise<{ name: string } | null> } } } }).__amble.store;
    return (await store.handles.get(wid))?.name ?? null;
  }, worldIdOf(page));
  expect(kept).toBe('Moon King.amble');
});

test('dropping a file on the Trail opens it', async ({ page }) => {
  const id = await openStarter(page);
  const bytes = await page.evaluate(async (wid) => {
    const a = (window as unknown as { __amble: { services: { store: { worlds: { get(id: string): Promise<unknown> } }; files: { write(w: unknown, k: string): Promise<Blob> } } } }).__amble;
    const world = await a.services.store.worlds.get(wid);
    return [...new Uint8Array(await (await a.services.files.write(world, 'world')).arrayBuffer())];
  }, id);
  await gotoRoute(page, '#/trail');
  await page.evaluate((b) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(b)], 'Moon King.amble', { type: 'application/x-amble' }));
    const fire = (type: string) => document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    fire('dragenter');
    fire('dragover');
    (window as unknown as { __m6overlay: boolean }).__m6overlay = document.getElementById('file-drop')?.classList.contains('file-drop--on') ?? false;
    fire('drop');
  }, bytes);
  expect(await page.evaluate(() => (window as unknown as { __m6overlay: boolean }).__m6overlay)).toBe(true);
  await expect(page).toHaveURL(/#\/w\/[A-Za-z0-9_-]+$/);
  expect(worldIdOf(page)).not.toBe(id);
  await expect(page.locator('#file-drop')).not.toHaveClass(/file-drop--on/);
});

test('a file that is not a world says so, and nothing opens', async ({ page }) => {
  await gotoRoute(page, '#/trail');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['not a zip'], 'homework.amble'));
    document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.getByTestId('toasts').getByText("This file isn't an Amble world, or it's damaged.")).toBeVisible();
  await expect(page).toHaveURL(/#\/trail$/);
});
