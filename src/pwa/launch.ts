/**
 * The installed app as a file handler (§4.6): the web manifest's `file_handlers` lets ChromeOS open
 * `.amble` files with Amble ("Open with"), and the files arrive through `launchQueue`. With
 * `launch_handler.client_mode: focus-existing` they come to the open window, so nothing reloads.
 */
import type { OpenItem } from '../files/open';

interface LaunchParams {
  files?: readonly FileSystemHandle[];
}

interface LaunchQueue {
  setConsumer(fn: (params: LaunchParams) => void): void;
}

/** Hands launched files to `open`. False when this browser has no launch queue (not installed, not Chromium). */
export function installLaunchQueue(open: (items: OpenItem[]) => Promise<unknown>, win: object = typeof window === 'undefined' ? {} : window): boolean {
  const queue = (win as { launchQueue?: LaunchQueue }).launchQueue;
  if (!queue || typeof queue.setConsumer !== 'function') return false;
  queue.setConsumer((params) => {
    const handles = (params.files ?? []).filter((h): h is FileSystemFileHandle => h.kind === 'file');
    if (!handles.length) return;
    void Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })))
      .then(open)
      .catch((err: unknown) => console.warn('A launched file did not open:', err));
  });
  return true;
}
