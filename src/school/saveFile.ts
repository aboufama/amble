/**
 * Saving a file the Teacher desk or Settings made (feedback CSV, an assignment file, "Save all my worlds"):
 * the system save picker when the browser offers it (ChromeOS lists Google Drive there), else a plain
 * download. Worlds are saved by `FilesApi.saveWorld` (M6), which also keeps the file handle.
 */

interface SavePickerWindow {
  showSaveFilePicker?(o: { suggestedName: string; types?: Array<{ description: string; accept: Record<string, string[]> }> }): Promise<{
    name: string;
    createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
}

export interface SavedFile {
  name: string;
  method: 'fs-access' | 'download';
}

/** A download through a temporary link (it lands in Downloads, or Drive when the school set that up). */
export function downloadBlob(blob: Blob, name: string): SavedFile {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { name, method: 'download' };
}

/** Saves a blob; null when the teacher or student cancelled the picker. */
export async function saveBlob(blob: Blob, name: string, type: { description: string; mime: string; ext: string }): Promise<SavedFile | null> {
  const w = window as unknown as SavePickerWindow;
  if (typeof w.showSaveFilePicker !== 'function') return downloadBlob(blob, name);
  try {
    const handle = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: type.description, accept: { [type.mime]: [type.ext] } }] });
    const out = await handle.createWritable();
    await out.write(blob);
    await out.close();
    return { name: handle.name, method: 'fs-access' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    // The picker is blocked by policy (or failed): a download still works.
    return downloadBlob(blob, name);
  }
}
