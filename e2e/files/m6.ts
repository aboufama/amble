/**
 * M6's e2e helpers: the dev harness (M6's components over the running app, until the Trail and the world
 * screen embed them), and file pickers backed by the origin-private file system, so saved files are
 * real `FileSystemFileHandle`s (kept in IndexedDB, overwritten by later saves) and nothing leaves the page.
 */
import type { Page } from '@playwright/test';
import { expect } from '../helpers/app';

/** Mounts M6's harness (src/screens/files/harness/panel.tsx) over the running dev app. */
export async function injectHarness(page: Page): Promise<void> {
  await page.addScriptTag({ type: 'module', url: '/src/screens/files/harness/panel.tsx' });
  await page.waitForFunction(() => document.documentElement.dataset.m6 === 'ready');
}

/**
 * Replaces the pickers before the app loads: Save writes into the private file system under the
 * suggested name; Open returns `window.__m6open` names from there. `readOnly` names answer 'denied'
 * to write permission (a file that was turned in). `noPicker` removes them (the download fallback).
 */
export async function fakePickers(page: Page, o: { noPicker?: boolean } = {}): Promise<void> {
  await page.addInitScript((noPicker: boolean) => {
    const w = window as unknown as Record<string, unknown>;
    if (noPicker) {
      for (const name of ['showSaveFilePicker', 'showOpenFilePicker', 'showDirectoryPicker']) {
        delete w[name];
        delete (Window.prototype as unknown as Record<string, unknown>)[name];
      }
      return;
    }
    const dir = () => navigator.storage.getDirectory();
    w.__m6saves = [] as string[];
    w.__m6open = [] as string[];
    w.__m6readOnly = [] as string[];
    w.showSaveFilePicker = async (opts: { suggestedName?: string }) => {
      const name = opts?.suggestedName ?? 'untitled.amble';
      (w.__m6saves as string[]).push(name);
      return (await dir()).getFileHandle(name, { create: true });
    };
    w.showOpenFilePicker = async () => {
      const names = w.__m6open as string[];
      if (!names.length) throw new DOMException('Closed', 'AbortError');
      const d = await dir();
      return Promise.all(names.map((n) => d.getFileHandle(n)));
    };
    const proto = FileSystemFileHandle.prototype as unknown as { queryPermission?: (d: unknown) => Promise<string> };
    proto.queryPermission = async function (this: FileSystemFileHandle) {
      return (w.__m6readOnly as string[]).includes(this.name) ? 'denied' : 'granted';
    };
    (proto as { requestPermission?: unknown }).requestPermission = proto.queryPermission;
  }, o.noPicker ?? false);
}

/** Bytes of a file in the private file system (what the fake picker saved). */
export async function savedBytes(page: Page, name: string): Promise<number[]> {
  return page.evaluate(async (n) => {
    const d = await navigator.storage.getDirectory();
    const f = await (await d.getFileHandle(n)).getFile();
    return [...new Uint8Array(await f.arrayBuffer())];
  }, name);
}

/** Writes bytes into the private file system (a file for the fake open picker). */
export async function putFile(page: Page, name: string, bytes: number[]): Promise<void> {
  await page.evaluate(
    async ({ n, b }) => {
      const d = await navigator.storage.getDirectory();
      const h = await d.getFileHandle(n, { create: true });
      const s = await h.createWritable();
      await s.write(new Uint8Array(b));
      await s.close();
    },
    { n: name, b: bytes },
  );
}

export async function clearFiles(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const d = await navigator.storage.getDirectory();
    for await (const name of (d as unknown as { keys(): AsyncIterable<string> }).keys()) await d.removeEntry(name);
  });
}

/** The id of the world the route shows (`#/w/<id>`). */
export function worldIdOf(page: Page): string {
  const hash = new URL(page.url()).hash;
  const m = /^#\/w\/([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) throw new Error(`Not in a world: ${hash}`);
  return m[1];
}

/** Opens the Moon King starter as a new world and returns its id. */
export async function openStarter(page: Page): Promise<string> {
  await page.evaluate(() => {
    location.hash = '#/starter/moon-king';
  });
  await expect(page).toHaveURL(/#\/w\/[A-Za-z0-9_-]+$/);
  await expect(page.getByTestId('screen-world')).toBeVisible();
  return worldIdOf(page);
}
