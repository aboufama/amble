/**
 * Opening files (§4.6, §2.16), whatever brought them: Open a file, a drop on the Trail, or the installed
 * app's file handler. Each file is checked, then:
 * - too big (over 60 MB): refused with its size; big (over 40 MB): a note, then it opens;
 * - an old Amble project (JSON, format 'amble' v1): the rescue card, then its drawings come in;
 * - a drawing: onto the Trail; an assignment: always the student's own copy;
 * - a world: a new world, unless the same file is already open here; a read-only file (a turned-in
 *   copy) opens as a copy and offers Save my own copy.
 * Nothing here ever throws at the student: every problem becomes the §2.16 copy.
 */
import { navigate } from '../app/router';
import { getServices } from '../app/services';
import { t } from '../i18n';
import { LIMITS } from '../model/limits';
import type { AmbleFile, ArtId, WorldId } from '../model/types';
import { announce, showToast } from '../state/app';
import { getState } from '../state/store';
import { megabytes } from '../store/quota';
import { alertUser, confirmUser } from '../ui/dialogs';
import type { FilesApi } from './api';
import { tooBig } from './amble';
import { writePermission } from './fsAccess';
import { legacyFromFileText } from './legacy';
import { FileProblem } from './problem';
import { askReadOnly, warnBigFile } from './service';

export interface OpenItem {
  file: File;
  handle: FileSystemFileHandle | null;
}

export interface OpenOutcome {
  worlds: WorldId[];
  drawings: ArtId[];
  failed: number;
}

async function startsWithJson(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  let i = 0;
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) i = 3;
  while (i < head.length && (head[i] === 0x20 || head[i] === 0x0a || head[i] === 0x0d || head[i] === 0x09)) i++;
  return head[i] === 0x7b;
}

/** The world this same file is already open as (the kept handle points at it, and the file isn't newer). */
async function alreadyOpen(files: FilesApi, item: OpenItem): Promise<WorldId | null> {
  if (!item.handle) return null;
  const { store } = getServices();
  let kept: Array<{ worldId: WorldId; handle: FileSystemFileHandle }> = [];
  try {
    kept = await store.handles.all();
  } catch {
    return null;
  }
  for (const k of kept) {
    let same = false;
    try {
      same = await k.handle.isSameEntry(item.handle);
    } catch {
      same = false;
    }
    if (!same) continue;
    const world = await store.worlds.get(k.worldId).catch(() => null);
    if (!world) continue;
    const saved = await files.lastSaved(k.worldId);
    // A copy changed somewhere else (another Chromebook) is newer: open it as its own world instead.
    if (saved && item.file.lastModified > saved.at + 2000) return null;
    return k.worldId;
  }
  return null;
}

function problemText(err: unknown): string {
  return err instanceof FileProblem ? err.message : t('files.notAmble');
}

async function openLegacyJson(files: FilesApi, file: File): Promise<WorldId | null> {
  const legacy = legacyFromFileText(await file.text());
  if (!legacy) throw new FileProblem('not-amble', t('files.notAmble'));
  const yes = await confirmUser({ title: t('files.legacy_heading'), body: t('files.legacy_found', { title: legacy.title }), ok: t('files.legacy_bring'), cancel: t('files.notNow') });
  if (!yes) return null;
  announce(t('files.legacy_bringing'));
  const id = await files.legacy.bring(legacy);
  showToast(t('files.legacy_brought', { title: legacy.title }), { kind: 'success' });
  return id;
}

async function openOne(files: FilesApi, item: OpenItem, out: OpenOutcome): Promise<'world' | 'drawing' | 'failed' | 'skipped'> {
  const { file } = item;
  if (file.size > LIMITS.ambleFileBytes) {
    await alertUser({ title: t('files.tooBigTitle'), body: tooBig(file.size).message });
    return 'failed';
  }
  if (await startsWithJson(file)) {
    const id = await openLegacyJson(files, file);
    if (!id) return 'skipped';
    out.worlds.push(id);
    return 'world';
  }
  if (file.size > LIMITS.worldBlobsWarnBytes) await warnBigFile(megabytes(file.size));

  const existing = await alreadyOpen(files, item);
  if (existing) {
    const { store } = getServices();
    await store.worlds.restore(existing).catch(() => undefined);
    out.worlds.push(existing);
    return 'world';
  }

  const read: AmbleFile = await files.read(file);
  if (read.manifest.kind === 'drawing') {
    const ids = await files.importDrawing(read);
    out.drawings.push(...ids);
    const name = read.art[0]?.name ?? read.manifest.title;
    showToast(t('files.drawingOpened', { name }), { kind: 'success', action: ids[0] ? { label: t('files.openIt'), run: () => navigate({ name: 'drawFree', artId: ids[0] }) } : undefined });
    return 'drawing';
  }

  const assignment = read.manifest.kind === 'assignment';
  const readOnly = !assignment && item.handle !== null && (await writePermission(item.handle, false)) === 'denied';
  const worldId = await files.importWorld(read, { asCopy: assignment || readOnly, fileName: file.name });
  if (item.handle && !assignment && !readOnly) {
    const { store } = getServices();
    await store.handles.put(worldId, item.handle).catch(() => undefined);
    await store.cache.put(`saved:${worldId}`, { name: item.handle.name, at: Math.max(file.lastModified, Date.now()), method: 'fs-access' }).catch(() => undefined);
  }
  if (read.warnings.length) showToast(read.warnings[0], { kind: 'error' });
  out.worlds.push(worldId);
  if (assignment || readOnly) void offerOwnCopy(files, worldId, assignment);
  return 'world';
}

/** After an assignment file or a read-only copy opens: the note, and Save my own copy. */
async function offerOwnCopy(files: FilesApi, worldId: WorldId, assignment: boolean): Promise<void> {
  const yes = assignment
    ? await confirmUser({ title: t('files.assignmentTitle'), body: t('files.assignmentCopy'), ok: t('files.saveOwnCopy'), cancel: t('files.notNow') })
    : await askReadOnly();
  if (!yes) return;
  const world = await getServices().store.worlds.get(worldId);
  if (!world) return;
  try {
    const saved = await files.saveWorld(world, { saveAs: true });
    if (saved) showToast(saved.method === 'download' ? t('files.savedDownload') : t('files.savedToFile', { name: saved.name }), { kind: 'success' });
  } catch {
    showToast(t('files.saveFailed'), { kind: 'error' });
  }
}

/** Opens what the student chose. `navigate`: go to the world when exactly one opened (default true). */
export async function openItems(items: OpenItem[], o: { navigate?: boolean } = {}): Promise<OpenOutcome> {
  const { files } = getServices();
  const out: OpenOutcome = { worlds: [], drawings: [], failed: 0 };
  for (const item of items) {
    announce(t('files.opening', { name: item.file.name }));
    try {
      const r = await openOne(files, item, out);
      if (r === 'failed') out.failed++;
    } catch (err) {
      out.failed++;
      if (!(err instanceof FileProblem)) console.warn('A file did not open:', err);
      showToast(problemText(err), { kind: 'error' });
    }
  }
  if (out.worlds.length === 1 && o.navigate !== false) {
    const id = out.worlds[0];
    const route = getState().app.route;
    if (!(route.name === 'world' && route.id === id)) navigate({ name: 'world', id });
  } else if (out.worlds.length > 1) {
    showToast(t('files.openedMany', { n: out.worlds.length }), { kind: 'success' });
  }
  return out;
}

/** Open a file: the picker (handles kept), then the open flow. */
export async function openFromPicker(o: { multiple?: boolean } = {}): Promise<OpenOutcome> {
  const { files } = getServices();
  const picked = await files.pick(o.multiple ?? false);
  if (!picked.length) return { worlds: [], drawings: [], failed: 0 };
  return openItems(picked);
}
