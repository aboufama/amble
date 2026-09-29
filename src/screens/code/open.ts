/**
 * Opens Look inside at a place, from anywhere (no CodeMirror here, so other screens can import it): a
 * file and line (the problem card's "Show me the line"), or with the AI helper's explanation as a note
 * beside the lines it explains (explain-only classes answer there, §2.8).
 */
import { navigate } from '../../app/router';
import type { ExplainReply, WorldId } from '../../model/types';

export interface LookInsideRequest {
  worldId: WorldId;
  file: string;
  /** 1-based: the cursor goes there. */
  line?: number;
  /** An answer from the AI helper about lines `from`-`to` of `file`. */
  explain?: { from: number; to: number; reply: ExplainReply };
}

/** Where Look inside keeps a world's changes that were not run yet (the store's cache). */
export function codeDraftKey(worldId: WorldId): string {
  return `code-draft:${worldId}`;
}

let pending: LookInsideRequest | null = null;
const listeners = new Set<(r: LookInsideRequest) => void>();

/** Goes to Look inside for a world and shows the place (or the note) there. */
export function lookInside(request: LookInsideRequest): void {
  pending = request;
  for (const fn of listeners) fn(request);
  navigate({ name: 'code', worldId: request.worldId, file: request.file });
}

/** For the code view: the request made for this world before it opened (taken once). */
export function takeLookInside(worldId: WorldId): LookInsideRequest | null {
  if (!pending || pending.worldId !== worldId) return null;
  const r = pending;
  pending = null;
  return r;
}

/** For the code view while it is open: requests as they come. */
export function onLookInside(fn: (r: LookInsideRequest) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
