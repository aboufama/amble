/**
 * Save to Drive (§4.6): the first save asks where (the picker suggests "<title>.amble"), later saves
 * overwrite the kept file with no picker, a read-only file (turned in) offers Save my own copy, a closed
 * picker saves nothing, and a picker blocked by policy falls back to a download.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PickerHost } from '../../src/files/fsAccess';
import { createFiles } from '../../src/files/service';
import { readAmble } from '../../src/files/amble';
import { onSavedToFile } from '../../src/files/saved';
import { createStarterStub } from '../../src/starters/api';
import { MemoryStore } from '../../src/store/memory';
import { seedWorld } from './fixtures';

class FakeHandle {
  readonly kind = 'file';
  data: Blob | null = null;
  perm: PermissionState = 'granted';
  writes = 0;
  constructor(readonly name: string) {}
  async queryPermission() {
    return this.perm;
  }
  async requestPermission() {
    return this.perm;
  }
  async createWritable() {
    if (this.perm === 'denied') throw new DOMException('Read-only', 'NotAllowedError');
    const parts: Blob[] = [];
    return {
      write: async (b: Blob) => void parts.push(b),
      close: async () => {
        this.data = new Blob(parts);
        this.writes++;
      },
      abort: async () => undefined,
    };
  }
  async getFile() {
    return new File([this.data ?? new Blob()], this.name);
  }
  async isSameEntry(o: unknown) {
    return o === this;
  }
}

function pickers(o: { cancel?: boolean; blocked?: boolean } = {}) {
  const made: FakeHandle[] = [];
  const names: string[] = [];
  const host: PickerHost = {
    showSaveFilePicker: async (opts) => {
      names.push(opts?.suggestedName ?? '');
      if (o.cancel) throw new DOMException('Closed', 'AbortError');
      if (o.blocked) throw new DOMException('Policy', 'SecurityError');
      const h = new FakeHandle(opts?.suggestedName ?? 'x.amble');
      made.push(h);
      return h as unknown as FileSystemFileHandle;
    },
  };
  return { host, made, names };
}

let downloads: Array<{ name: string }> = [];

beforeEach(() => {
  downloads = [];
  // The download fallback's <a download>: a document with just enough of an anchor.
  vi.stubGlobal('document', {
    createElement: () => {
      const a = { href: '', download: '', rel: '', hidden: false, click: () => downloads.push({ name: a.download }), remove: () => undefined };
      return a;
    },
    body: { append: () => undefined },
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
  vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Save to Drive', () => {
  it('asks where the first time, then overwrites the same file with no picker', async () => {
    const store = new MemoryStore();
    const { world } = await seedWorld(store);
    const p = pickers();
    const saved: string[] = [];
    const stop = onSavedToFile((id) => saved.push(id));
    const files = createFiles({ store: () => store, history: () => null, starters: () => createStarterStub(), pickers: p.host, now: () => 1000 });
    const first = await files.saveWorld(world);
    expect(first).toEqual({ name: 'Moon King.amble', at: 1000, method: 'fs-access' });
    expect(p.names).toEqual(['Moon King.amble']);
    expect(await store.handles.get(world.id)).toBe(p.made[0]);
    const second = await files.saveWorld({ ...world, title: 'Moon King 2' });
    expect(second?.method).toBe('fs-access');
    expect(p.names).toHaveLength(1);
    expect(p.made[0].writes).toBe(2);
    const back = await readAmble(p.made[0].data!);
    expect(back.world?.title).toBe('Moon King 2');
    expect(await files.lastSaved(world.id)).toEqual({ name: 'Moon King.amble', at: 1000, method: 'fs-access' });
    expect(saved).toEqual([world.id, world.id]);
    stop();
  });

  it('offers Save my own copy when the kept file is read-only', async () => {
    const store = new MemoryStore();
    const { world } = await seedWorld(store);
    const p = pickers();
    const asked: number[] = [];
    const files = createFiles({ store: () => store, history: () => null, starters: () => createStarterStub(), pickers: p.host, askReadOnly: async () => (asked.push(1), true) });
    await files.saveWorld(world);
    p.made[0].perm = 'denied';
    const copy = await files.saveWorld(world);
    expect(asked).toHaveLength(1);
    expect(copy?.name).toBe('Moon King (copy).amble');
    expect(await store.handles.get(world.id)).toBe(p.made[1]);
  });

  it('saves nothing when the picker is closed', async () => {
    const store = new MemoryStore();
    const { world } = await seedWorld(store);
    const p = pickers({ cancel: true });
    const files = createFiles({ store: () => store, history: () => null, starters: () => createStarterStub(), pickers: p.host });
    expect(await files.saveWorld(world)).toBeNull();
    expect(await store.handles.get(world.id)).toBeNull();
    expect(downloads).toEqual([]);
  });

  it('downloads the file when the picker is missing or blocked by policy', async () => {
    const store = new MemoryStore();
    const { world } = await seedWorld(store);
    const blocked = createFiles({ store: () => store, history: () => null, starters: () => createStarterStub(), pickers: pickers({ blocked: true }).host });
    expect(await blocked.saveWorld(world)).toMatchObject({ method: 'download', name: 'Moon King.amble' });
    const missing = createFiles({ store: () => store, history: () => null, starters: () => createStarterStub(), pickers: {} });
    expect(await missing.saveWorld(world, { name: 'Moon King - J.R.amble' })).toMatchObject({ method: 'download', name: 'Moon King - J.R.amble' });
    expect(downloads.map((d) => d.name)).toEqual(['Moon King.amble', 'Moon King - J.R.amble']);
    expect(await store.handles.get(world.id)).toBeNull();
  });

  it('packs every world into one zip for Save all my worlds', async () => {
    const store = new MemoryStore();
    const { world } = await seedWorld(store);
    await store.commit({ worlds: [{ ...world, id: 'w_second0001', title: 'Moon King' }] });
    const files = createFiles({ store: () => store, history: () => null, starters: () => createStarterStub(), pickers: {} });
    const zip = await files.saveAll();
    const { unzipSync } = await import('fflate');
    const names = Object.keys(unzipSync(new Uint8Array(await zip.arrayBuffer()))).sort();
    expect(names).toEqual(['Moon King (2).amble', 'Moon King.amble']);
  });
});
