/**
 * M7's e2e helpers: file pickers backed by the origin-private file system (Save writes there under the
 * suggested name; the folder picker opens its `class` folder), real `.amble` files made by the app's own
 * FilesApi, and a world with an assignment for Hand in.
 */
import type { Page } from '@playwright/test';

type AmbleWindow = Window & {
  __amble: {
    services: {
      starters: { open(id: string, o: { withArt: boolean }): Promise<{ world: Record<string, unknown> }> };
      files: { write(world: unknown, kind: 'world' | 'assignment'): Promise<Blob> };
      store: { worlds: { get(id: string): Promise<Record<string, unknown> | null> }; commit(c: unknown): Promise<void> };
    };
    getState(): Record<string, any>;
  };
  __saves: string[];
};

/** Replaces the save and folder pickers before the app loads. */
export async function fakePickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const root = () => navigator.storage.getDirectory();
    w.__saves = [] as string[];
    w.showSaveFilePicker = async (opts: { suggestedName?: string }) => {
      const name = opts?.suggestedName ?? 'untitled';
      (w.__saves as string[]).push(name);
      return (await root()).getFileHandle(name, { create: true });
    };
    w.showDirectoryPicker = async () => (await root()).getDirectoryHandle('class', { create: true });
    const proto = FileSystemHandle.prototype as unknown as { queryPermission?: unknown; requestPermission?: unknown };
    proto.queryPermission = async () => 'granted';
    proto.requestPermission = async () => 'granted';
  });
}

/** Names the fake save picker was asked for, in order. */
export function saves(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as AmbleWindow).__saves);
}

/** The text of a file the fake save picker wrote. */
export function savedText(page: Page, name: string): Promise<string> {
  return page.evaluate(async (n) => (await (await (await navigator.storage.getDirectory()).getFileHandle(n)).getFile()).text(), name);
}

export interface StudentFile {
  name: string;
  title: string;
  madeBy: string;
  /** An extra file that doesn't parse (the card says so). */
  broken?: boolean;
}

/**
 * Writes student files into the `class` folder: Moon King worlds made by the app's FilesApi, each with
 * Boss Battle Week's goals, plus any raw files (`{ name, text }`).
 */
export async function putClassFolder(page: Page, worlds: StudentFile[], raw: Array<{ name: string; text: string }> = []): Promise<void> {
  await page.evaluate(
    async ({ worlds, raw }) => {
      const { services } = (window as unknown as AmbleWindow).__amble;
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('class', { create: true });
      const put = async (name: string, data: Blob | string) => {
        const handle = await dir.getFileHandle(name, { create: true });
        const out = await handle.createWritable();
        await out.write(data);
        await out.close();
      };
      const { world } = await services.starters.open('moon-king', { withArt: false });
      for (const s of worlds) {
        const w = structuredClone(world) as Record<string, any>;
        w.title = s.title;
        w.credits = { madeBy: s.madeBy };
        w.assignment = {
          id: 'as_boss',
          title: 'Boss Battle Week',
          text: 'Make a boss fight.',
          starter: 'moon-king',
          require: ['hero', 'boss'],
          goals: [
            { id: 'g1', label: 'Hero drawn by the student', kind: 'auto', check: { type: 'drawn', key: 'hero' } },
            { id: 'g2', label: 'Boss has 2+ attacks', kind: 'auto', check: { type: 'boss-attacks', min: 2 } },
            { id: 'g3', label: 'A creative twist', kind: 'teacher' },
          ],
          ai: 'on',
          level: null,
          due: 'Friday',
          locked: {},
        };
        if (s.broken) w.code = [...w.code, { path: 'oops.js', source: 'const a = ;', authors: [['student', 1]], locked: [] }];
        await put(s.name, await services.files.write(w, 'world'));
      }
      for (const r of raw) await put(r.name, r.text);
    },
    { worlds, raw },
  );
}

/**
 * Stores a Moon King world with Boss Battle Week (as a class link's assignment makes one) and returns its
 * id. It is written before any screen opens it, so no open world can save over it.
 */
export async function worldWithAssignment(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const { services } = (window as unknown as AmbleWindow).__amble;
    const { world } = await services.starters.open('moon-king', { withArt: false });
    const w = structuredClone(world) as Record<string, any>;
    w.id = `w_${Math.random().toString(36).slice(2, 12).padEnd(10, '0')}`;
    w.assignment = {
      id: 'as_boss',
      title: 'Boss Battle Week',
      text: 'Draw your own hero and boss.',
      starter: 'moon-king',
      require: [],
      goals: [
        { id: 'g1', label: 'Hero drawn by the student', kind: 'auto', check: { type: 'drawn', key: 'hero' } },
        { id: 'g2', label: 'Boss has 2+ attacks', kind: 'auto', check: { type: 'boss-attacks', min: 2 } },
      ],
      ai: 'on',
      level: null,
      due: 'Friday',
      locked: {},
    };
    await services.store.commit({ worlds: [w] });
    return w.id as string;
  });
}
