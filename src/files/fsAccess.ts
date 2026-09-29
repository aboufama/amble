/**
 * Save to Drive and Open (§4.6) over the File System Access API, with the fallbacks schools need.
 * - Save: `showSaveFilePicker` (ChromeOS lists Google Drive in it); the handle is kept so later saves
 *   overwrite silently, asking for permission again when the browser needs it. When the API is missing
 *   or blocked by policy: `<a download>` (which lands in Drive when the district points Downloads there).
 * - Open: `showOpenFilePicker`, or `<input type=file>`; a folder with `showDirectoryPicker`, or
 *   `<input webkitdirectory>`.
 * The picker is always shown first, while the click still counts as a user gesture; the file is built
 * after, so a big world never makes the browser refuse the picker.
 */

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

interface SavePickerOptions {
  suggestedName?: string;
  types?: PickerType[];
  excludeAcceptAllOption?: boolean;
  id?: string;
}

interface OpenPickerOptions {
  multiple?: boolean;
  types?: PickerType[];
  excludeAcceptAllOption?: boolean;
  id?: string;
}

type PermissionMode = { mode: 'read' | 'readwrite' };

/** The parts of a handle this module uses beyond lib.dom (permissions are Chromium-only). */
export type PermissionedHandle = FileSystemFileHandle & {
  queryPermission?(d: PermissionMode): Promise<PermissionState>;
  requestPermission?(d: PermissionMode): Promise<PermissionState>;
};

type DirHandle = FileSystemDirectoryHandle & {
  values?(): AsyncIterable<FileSystemHandle>;
};

/** The window's pickers (tests replace them with fakes through `addInitScript`). */
export interface PickerHost {
  showSaveFilePicker?(o?: SavePickerOptions): Promise<FileSystemFileHandle>;
  showOpenFilePicker?(o?: OpenPickerOptions): Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?(o?: { id?: string; mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
}

export type SaveKind = 'amble' | 'png' | 'html' | 'zip' | 'csv';

const TYPES: Record<SaveKind, PickerType> = {
  amble: { description: 'Amble world', accept: { 'application/x-amble': ['.amble'] } },
  png: { description: 'Picture', accept: { 'image/png': ['.png'] } },
  html: { description: 'Web page', accept: { 'text/html': ['.html'] } },
  zip: { description: 'Zip file', accept: { 'application/zip': ['.zip'] } },
  csv: { description: 'Spreadsheet', accept: { 'text/csv': ['.csv'] } },
};

/** The picker remembers its last folder per id (the student's Drive folder, the class folder). */
const PICKER_ID: Record<SaveKind, string> = { amble: 'amble-worlds', png: 'amble-pictures', html: 'amble-pages', zip: 'amble-worlds', csv: 'amble-class' };

function host(): PickerHost {
  return (typeof window === 'undefined' ? {} : window) as PickerHost;
}

function errName(err: unknown): string {
  return err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
}

/** The student closed the picker. */
export function isCancel(err: unknown): boolean {
  return errName(err) === 'AbortError';
}

/** Writing is not allowed: a read-only (turned-in) file, or permission refused. */
export class ReadOnlyFile extends Error {
  constructor() {
    super('This file is read-only.');
    this.name = 'ReadOnlyFile';
  }
}

function isReadOnlyError(err: unknown): boolean {
  const name = errName(err);
  return name === 'NotAllowedError' || name === 'NoModificationAllowedError' || name === 'InvalidModificationError';
}

/** ChromeOS says "Save to Drive"; elsewhere the same button says "Save file" (§2.6). */
export function isChromeOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return data?.platform === 'Chrome OS' || data?.platform === 'ChromeOS' || /\bCrOS\b/.test(navigator.userAgent);
}

/** Whether the save picker can be offered here (not in a cross-origin frame, not removed by policy). */
export function canPickToSave(h: PickerHost = host()): boolean {
  if (typeof h.showSaveFilePicker !== 'function') return false;
  try {
    return typeof window === 'undefined' || window.self === window.top;
  } catch {
    return false;
  }
}

/** Write permission for a kept handle: asked for (inside the gesture) when `request` is set. */
export async function writePermission(handle: FileSystemFileHandle, request: boolean): Promise<PermissionState> {
  const h = handle as PermissionedHandle;
  try {
    const now = (await h.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (now !== 'prompt' || !request) return now;
    return (await h.requestPermission?.({ mode: 'readwrite' })) ?? 'granted';
  } catch {
    return 'prompt';
  }
}

/** Replaces a file's contents. The browser writes a temporary copy and swaps it in on close, so a failed write never leaves half a file. */
export async function writeToHandle(handle: FileSystemFileHandle, blob: Blob): Promise<void> {
  let stream: FileSystemWritableFileStream;
  try {
    stream = await handle.createWritable();
  } catch (err) {
    if (isReadOnlyError(err)) throw new ReadOnlyFile();
    throw err;
  }
  try {
    await stream.write(blob);
    await stream.close();
  } catch (err) {
    await stream.abort().catch(() => undefined);
    if (isReadOnlyError(err)) throw new ReadOnlyFile();
    throw err;
  }
}

/** The download fallback: `<a download>` with an object URL (revoked a minute later). */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type SaveOutcome = { method: 'fs-access'; name: string; handle: FileSystemFileHandle } | { method: 'download'; name: string };

export interface SaveBlobOptions {
  kind: SaveKind;
  /** The file to overwrite (Ctrl+S on a world saved before). */
  handle?: FileSystemFileHandle | null;
  /** Skip the kept handle and the picker: go straight to a download (the picker was blocked). */
  download?: boolean;
  host?: PickerHost;
}

/**
 * Saves the blob `make()` builds: to the kept handle, else through the save picker, else as a download.
 * Resolves null when the student closes the picker; throws `ReadOnlyFile` when the kept file can't be
 * written.
 */
export async function saveBlob(make: () => Promise<Blob>, name: string, o: SaveBlobOptions): Promise<SaveOutcome | null> {
  const h = o.host ?? host();
  if (o.handle && !o.download) {
    const perm = await writePermission(o.handle, true);
    if (perm === 'denied') throw new ReadOnlyFile();
    if (perm === 'granted') {
      await writeToHandle(o.handle, await make());
      return { method: 'fs-access', name: o.handle.name, handle: o.handle };
    }
    // 'prompt' that could not be asked (no gesture left): pick the file again below.
  }
  if (!o.download && canPickToSave(h)) {
    let handle: FileSystemFileHandle | null = null;
    try {
      handle = await h.showSaveFilePicker!({ suggestedName: name, types: [TYPES[o.kind]], excludeAcceptAllOption: false, id: PICKER_ID[o.kind] });
    } catch (err) {
      if (isCancel(err)) return null;
      // SecurityError / NotAllowedError / TypeError: blocked by policy here. Download instead.
      handle = null;
    }
    if (handle) {
      await writeToHandle(handle, await make());
      return { method: 'fs-access', name: handle.name, handle };
    }
  }
  downloadBlob(await make(), name);
  return { method: 'download', name };
}

export interface PickedFile {
  file: File;
  handle: FileSystemFileHandle | null;
}

/** A hidden `<input type=file>`: resolves with the chosen files, or none when cancelled. */
function pickWithInput(o: { accept: string; multiple: boolean; directory?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = o.accept;
    input.multiple = o.multiple;
    if (o.directory) (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.hidden = true;
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish([...(input.files ?? [])]));
    input.addEventListener('cancel', () => finish([]));
    document.body.append(input);
    input.click();
  });
}

const AMBLE_ACCEPT = '.amble,application/x-amble';

/** Open a file: the open picker (keeping handles, so Save to Drive can overwrite the same file), or the input. */
export async function pickFiles(multiple: boolean, h: PickerHost = host()): Promise<PickedFile[]> {
  if (typeof h.showOpenFilePicker === 'function') {
    try {
      const handles = await h.showOpenFilePicker({ multiple, types: [TYPES.amble], excludeAcceptAllOption: false, id: PICKER_ID.amble });
      return await Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
    } catch (err) {
      if (isCancel(err)) return [];
      // Blocked by policy: the input still works.
    }
  }
  return (await pickWithInput({ accept: AMBLE_ACCEPT, multiple })).map((file) => ({ file, handle: null }));
}

const MAX_FOLDER_FILES = 400;

async function walk(dir: DirHandle, depth: number, out: File[]): Promise<void> {
  if (!dir.values || depth > 2) return;
  for await (const entry of dir.values()) {
    if (out.length >= MAX_FOLDER_FILES) return;
    if (entry.kind === 'file' && /\.amble$/i.test(entry.name)) out.push(await (entry as FileSystemFileHandle).getFile());
    else if (entry.kind === 'directory') await walk(entry as DirHandle, depth + 1, out);
  }
}

/** Every `.amble` in a folder and its subfolders (the Classroom folder), read-only. */
export async function pickFolder(h: PickerHost = host()): Promise<File[]> {
  if (typeof h.showDirectoryPicker === 'function') {
    try {
      const dir = await h.showDirectoryPicker({ id: PICKER_ID.csv, mode: 'read' });
      const out: File[] = [];
      await walk(dir as DirHandle, 0, out);
      return out;
    } catch (err) {
      if (isCancel(err)) return [];
    }
  }
  const files = await pickWithInput({ accept: AMBLE_ACCEPT, multiple: true, directory: true });
  return files.filter((f) => /\.amble$/i.test(f.name)).slice(0, MAX_FOLDER_FILES);
}
