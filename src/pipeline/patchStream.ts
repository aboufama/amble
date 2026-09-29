/**
 * Reading an AMBLE PATCH as it streams (§5.6): the core's parser, plus what the Ask card shows while the
 * reply arrives ("Writing boss.js +34 lines") and the new cast as soon as a streamed game.js closes its
 * `static art = { ... };` literal, so new members appear before the build finishes.
 */
import { createPatchParser, peekStaticLiteral, type FileAction, type Patch } from '../cores/ai';
import type { Spec } from './manifest';

export interface PatchStreamEvents {
  onFile?(path: string, action: FileAction): void;
  onLines?(path: string, lines: number): void;
  /** The streamed game.js declared its art (once per distinct set of keys). */
  onArt?(art: Record<string, Spec>): void;
}

export interface PatchStream {
  feed(delta: string): void;
  end(): Patch;
  readonly text: string;
}

const isSpecs = (v: unknown): v is Record<string, Spec> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((s) => typeof s === 'object' && s !== null && !Array.isArray(s));

export function createPatchStream(events: PatchStreamEvents = {}): PatchStream {
  const parser = createPatchParser();
  let text = '';
  let artSeen = '';

  const peekArt = (path: string, code: string) => {
    if (path !== 'game.js' || !events.onArt || !code.includes('static art')) return;
    const art = peekStaticLiteral(code, 'art');
    if (!isSpecs(art)) return;
    const keys = Object.keys(art).sort().join(',');
    if (keys === artSeen) return;
    artSeen = keys;
    events.onArt(art);
  };

  return {
    get text() {
      return text;
    },
    feed(delta: string) {
      text += delta;
      for (const e of parser.feed(delta)) {
        if (e.type === 'file') events.onFile?.(e.path, e.action);
        else if (e.type === 'lines') events.onLines?.(e.path, e.count);
        else if (e.type === 'fileDone' && (e.op.action === 'create' || e.op.action === 'replace')) peekArt(e.op.path, e.op.content);
      }
      const open = parser.openBlock();
      if (open && open.action !== 'edit' && !artSeen) peekArt(open.path, open.text);
    },
    end: () => parser.end(),
  };
}
