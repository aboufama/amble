/**
 * The app's `FilesApi` (§4.6, §4.7, §8.4): `.amble` files, Save to Drive with a kept handle and the
 * download fallback, open, share as a web page, Save all my worlds and the old-Amble rescue. Its
 * dependencies are read when used (the store, Footsteps, the starters), so it can be created before the
 * other services exist.
 */
import { getServices } from '../app/services';
import type { FilesApi, SavedFile } from './api';
import type { HistoryApi } from '../history/api';
import { t } from '../i18n';
import { blobRefOf } from '../model/ids';
import type { BlobRef, World, WorldId } from '../model/types';
import type { StarterCatalog } from '../starters/api';
import { getState } from '../state/store';
import type { Store } from '../store/api';
import { requestPersist } from '../store/quota';
import { alertUser, confirmUser } from '../ui/dialogs';
import { collectDrawing, collectWorld, packAmble, readAmble, withNewIds } from './amble';
import { pickFiles, pickFolder, ReadOnlyFile, saveBlob, type PickerHost } from './fsAccess';
import { bringLegacy, dismissLegacy, findLegacy } from './legacy';
import { browserPictures, browserSounds, type PictureMaker, type SoundMaker } from './media';
import { safeBaseName, withExtension, worldFileName } from './names';
import { FileProblem } from './problem';
import { packAllWorlds } from './saveAll';
import { emitSavedToFile } from './saved';
import { buildSharePage } from './share';

export interface FilesDeps {
  store(): Store;
  history(): HistoryApi | null;
  starters(): StarterCatalog;
  pictures: PictureMaker;
  sounds: SoundMaker;
  pickers?: PickerHost;
  now(): number;
  /** Replaces the old editor's IndexedDB read (tests). */
  legacyRead?: (key: string) => Promise<unknown>;
  /** Asks before keeping going with a read-only file (default: the app's dialog). */
  askReadOnly?(): Promise<boolean>;
}

const SAVED_KEY = (id: WorldId) => `saved:${id}`;

function defaultDeps(): FilesDeps {
  return {
    store: () => getServices().store,
    history: () => {
      try {
        return getServices().history;
      } catch {
        return null;
      }
    },
    starters: () => getServices().starters,
    pictures: browserPictures,
    sounds: browserSounds,
    now: () => Date.now(),
  };
}

/** "This copy is read-only (was it turned in?)" with [Save my own copy] and [Not now]. */
export function askReadOnly(): Promise<boolean> {
  return confirmUser({ title: t('files.readOnlyTitle'), body: t('files.readOnly'), ok: t('files.saveOwnCopy'), cancel: t('files.notNow') });
}

export function createFiles(over: Partial<FilesDeps> = {}): FilesApi {
  const deps: FilesDeps = { ...defaultDeps(), ...over };
  const handles = new WeakMap<File, FileSystemFileHandle>();

  const write = async (world: World, kind: 'world' | 'assignment'): Promise<Blob> => packAmble(await collectWorld(deps.store(), world, kind, deps.now()));

  const remember = async (worldId: WorldId, saved: SavedFile): Promise<void> => {
    await deps
      .store()
      .cache.put(SAVED_KEY(worldId), saved)
      .catch(() => undefined);
  };

  const api: FilesApi = {
    async saveWorld(world, o = {}) {
      const store = deps.store();
      const kept = o.saveAs ? null : await store.handles.get(world.id).catch(() => null);
      const name = o.name ?? kept?.name ?? worldFileName(world.title);
      try {
        const out = await saveBlob(() => write(world, 'world'), name, { kind: 'amble', handle: kept, host: deps.pickers });
        if (!out) return null;
        const saved: SavedFile = { name: out.name, at: deps.now(), method: out.method };
        if (out.method === 'fs-access') await store.handles.put(world.id, out.handle).catch(() => undefined);
        await remember(world.id, saved);
        emitSavedToFile(world.id);
        void requestPersist();
        return saved;
      } catch (err) {
        if (!(err instanceof ReadOnlyFile)) throw err;
        await store.handles.remove(world.id).catch(() => undefined);
        if (!(await (deps.askReadOnly ?? askReadOnly)())) return null;
        return api.saveWorld(world, { saveAs: true, name: worldFileName(t('files.copyTitle', { title: world.title }).slice(0, 40)) });
      }
    },

    async saveDrawing(artId) {
      const store = deps.store();
      const rec = await store.art.get(artId);
      if (!rec) throw new Error('That drawing is not here.');
      await saveBlob(async () => packAmble(await collectDrawing(store, artId, deps.now())), withExtension(safeBaseName(rec.name, 'My drawing'), 'amble'), { kind: 'amble', host: deps.pickers });
    },

    async savePicture(artId) {
      const store = deps.store();
      const rec = await store.art.get(artId);
      const flat = rec?.export ? await store.blobs.get(rec.export.flat) : null;
      if (!rec || !flat) throw new Error('That drawing has no picture yet.');
      await saveBlob(async () => flat, withExtension(safeBaseName(rec.name, 'My drawing'), 'png'), { kind: 'png', host: deps.pickers });
    },

    async openPicker(o) {
      const picked = await pickFiles(o.multiple, deps.pickers);
      for (const p of picked) if (p.handle) handles.set(p.file, p.handle);
      return picked.map((p) => p.file);
    },

    async pick(multiple) {
      const picked = await pickFiles(multiple, deps.pickers);
      for (const p of picked) if (p.handle) handles.set(p.file, p.handle);
      return picked;
    },

    handleOf: (file) => handles.get(file) ?? null,

    openFolder: () => pickFolder(deps.pickers),

    read: (file, o) => readAmble(file, o),

    async importWorld(f, o) {
      if (!f.world) throw new FileProblem('not-amble', t('files.notAmble'));
      const store = deps.store();
      const now = deps.now();
      const next = withNewIds(f, now);
      let world = next.world as World;
      if (o.asCopy) {
        world = { ...world, handIn: { fileName: null, savedAt: null, method: null, turnedInAt: null } };
        if (f.manifest.kind === 'assignment' && world.assignment) {
          world = { ...world, origin: { kind: 'assignment', assignmentId: world.assignment.id, starter: world.assignment.starter }, credits: { madeBy: '' } };
        }
      }
      const blobs = [...f.blobs.values()];
      const snapshots: Record<WorldId, BlobRef> = {};
      if (f.thumb) {
        blobs.push(f.thumb);
        snapshots[world.id] = await blobRefOf(f.thumb);
      }
      await store.commit({ blobs, art: next.art, steps: next.steps, worlds: [world], snapshots });
      const history = deps.history();
      if (history) {
        try {
          const recorded = await history.record(world, { kind: 'import', by: 'student', text: t('files.stepImported', { file: (o.fileName ?? worldFileName(world.title)).slice(0, 120) }) });
          await store.commit({ worlds: [recorded] });
        } catch (err) {
          console.warn('The import footstep was not recorded:', err);
        }
      }
      return world.id;
    },

    async importDrawing(f) {
      if (!f.art.length) throw new FileProblem('not-amble', t('files.notAmble'));
      const next = withNewIds({ world: null, art: f.art, steps: [] }, deps.now());
      const art = next.art.map((a) => ({ ...a, shelf: a.kind === 'character' ? true : a.shelf }));
      await deps.store().commit({ blobs: [...f.blobs.values()], art });
      return art.map((a) => a.id);
    },

    write,

    sharePage: (world) => buildSharePage(world, { captions: getState().prefs.captions }),

    async saveAll() {
      return (await packAllWorlds(deps.store(), deps.now())).zip;
    },

    async saveBlob(make, name, kind) {
      const out = await saveBlob(typeof make === 'function' ? make : async () => make, name, { kind, host: deps.pickers });
      return out ? { name: out.name, method: out.method } : null;
    },

    async lastSaved(worldId) {
      return deps
        .store()
        .cache.get<SavedFile>(SAVED_KEY(worldId))
        .catch(() => null);
    },

    legacy: {
      find: () => findLegacy({ store: deps.store(), read: deps.legacyRead }),
      bring: async (l) => (await bringLegacy({ store: deps.store(), starters: deps.starters(), history: deps.history(), pictures: deps.pictures, sounds: deps.sounds, now: deps.now }, l)).worldId,
      dismiss: (l) => dismissLegacy({ store: deps.store(), now: deps.now }, l ?? null),
    },
  };
  return api;
}

/** Shown by the open flow when a file is 40-60 MB: it still opens. */
export function warnBigFile(mb: number): Promise<void> {
  return alertUser({ title: t('files.bigFileTitle'), body: t('files.bigFile', { mb }) });
}
