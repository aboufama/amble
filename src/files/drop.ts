/**
 * Drag and drop (§2.4, §4.6): dropping a `.amble` file on the Trail (or the First page) opens it. A file
 * dropped anywhere else is caught too, so the browser never leaves Amble to show the file (a lost page is
 * lost work). Screens that take drops themselves (the Desk) handle them first and call preventDefault;
 * this listener then leaves them alone.
 */
import { t } from '../i18n';
import { showToast } from '../state/app';
import { getState } from '../state/store';
import type { Route } from '../app/routes';
import type { OpenItem } from './open';

type HandleItem = DataTransferItem & { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> };

/** Where a dropped world opens. */
export function dropOpensHere(route: Route): boolean {
  return route.name === 'home' || route.name === 'trail' || route.name === 'first';
}

function hasFiles(e: DragEvent): boolean {
  return [...(e.dataTransfer?.types ?? [])].includes('Files');
}

function overlay(): HTMLElement {
  let el = document.getElementById('file-drop');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'file-drop';
  el.className = 'file-drop';
  el.setAttribute('aria-hidden', 'true');
  const card = document.createElement('div');
  card.className = 'file-drop__card';
  const title = document.createElement('p');
  title.className = 'file-drop__title';
  title.textContent = t('files.dropHere');
  const hint = document.createElement('p');
  hint.className = 'file-drop__hint';
  hint.textContent = t('files.dropHint');
  card.append(title, hint);
  el.append(card);
  document.body.append(el);
  return el;
}

/** Reads the dropped files (with their handles where the browser gives them) during the drop event. */
function collect(e: DragEvent): Promise<OpenItem[]> {
  const items = [...(e.dataTransfer?.items ?? [])].filter((i) => i.kind === 'file') as HandleItem[];
  const pending = items.map((item) => {
    const file = item.getAsFile();
    const handle = item.getAsFileSystemHandle?.().catch(() => null) ?? Promise.resolve(null);
    return { file, handle };
  });
  if (!pending.length) for (const file of e.dataTransfer?.files ?? []) pending.push({ file, handle: Promise.resolve(null) });
  return Promise.all(
    pending.map(async ({ file, handle }) => {
      const h = await handle;
      return file ? { file, handle: h && h.kind === 'file' ? (h as FileSystemFileHandle) : null } : null;
    }),
  ).then((list) => list.filter((x): x is OpenItem => x !== null));
}

/** Shows or hides the "Drop your .amble file to open it" overlay. */
export function showDropOverlay(on: boolean): void {
  overlay().classList.toggle('file-drop--on', on);
}

export function installFileDrop(open: (items: OpenItem[]) => Promise<unknown>, win: Window = window): () => void {
  let depth = 0;
  const show = showDropOverlay;
  const onEnter = (e: DragEvent) => {
    if (!hasFiles(e) || !dropOpensHere(getState().app.route)) return;
    depth++;
    show(true);
  };
  const onLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) show(false);
  };
  const onOver = (e: DragEvent) => {
    if (!hasFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = dropOpensHere(getState().app.route) ? 'copy' : 'none';
  };
  const onDrop = (e: DragEvent) => {
    depth = 0;
    show(false);
    if (!hasFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    if (!dropOpensHere(getState().app.route)) return;
    void collect(e).then((items) => {
      const amble = items.filter((i) => /\.amble$/i.test(i.file.name));
      if (!amble.length) {
        showToast(t('files.dropHint'));
        return;
      }
      return open(amble);
    });
  };
  win.addEventListener('dragenter', onEnter);
  win.addEventListener('dragleave', onLeave);
  win.addEventListener('dragover', onOver);
  win.addEventListener('drop', onDrop);
  return () => {
    win.removeEventListener('dragenter', onEnter);
    win.removeEventListener('dragleave', onLeave);
    win.removeEventListener('dragover', onOver);
    win.removeEventListener('drop', onDrop);
    document.getElementById('file-drop')?.remove();
  };
}
