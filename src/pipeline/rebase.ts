/**
 * An accepted change put onto the world as it is now (§2.8). The job started from `base`; while it ran, the
 * student may have run code of their own in Look inside. Their code stays: the change goes in file by file
 * with a three-way merge (`mergeCode`), and where both changed the same lines the student's file stays and the
 * change to it is left out. What the code declares (the cast, the dials, new members) is read again when the
 * merged code is not the job's own. Pure: the caller commits the result.
 */
import type { HistoryApi } from '../history/api';
import { mergeCode } from '../history/merge';
import type { CastKey, CodeFile, GameManifest, World } from '../model/types';
import { manifestOf, readStatics } from './manifest';
import { handEditFile } from './service';

export interface Rebased {
  /** The world's code with the change in: unchanged lines keep their authors, the change's lines are the AI's. */
  code: CodeFile[];
  manifest: GameManifest;
  /** Members the change added (their cards wear a NEW ribbon). */
  newArt: CastKey[];
  /** Files the change changed in the world. */
  files: string[];
  /** Files the student changed meanwhile in the same lines: theirs stayed, and the change to them did not go in. */
  leftOut: string[];
  /** A file whose student-written lines the change rewrote, or null. */
  handFile: string | null;
}

/** The files whose text differs between two versions of a world's code (changed, added or removed). */
export function changedPaths(before: readonly CodeFile[], after: readonly CodeFile[]): string[] {
  const out = after.filter((f) => before.find((b) => b.path === f.path)?.source !== f.source).map((f) => f.path);
  for (const b of before) if (!after.some((f) => f.path === b.path)) out.push(b.path);
  return out;
}

const sameCode = (x: readonly CodeFile[], y: readonly CodeFile[]): boolean =>
  x.length === y.length && x.every((f) => y.some((g) => g.path === f.path && g.source === f.source));

export function rebaseChange(
  change: { files: readonly CodeFile[]; manifest: GameManifest; newArt?: readonly CastKey[] },
  o: { base: readonly CodeFile[]; world: World; attribute: HistoryApi['attribute'] },
): Rebased {
  const now = o.world.code;
  const { files: merged, leftOut } = mergeCode(o.base, now, change.files);
  const code = o.attribute([...now], merged, 'ai');
  let manifest = change.manifest;
  let newArt = [...(change.newArt ?? [])];
  // The job read its own files; merged code (the student's lines too, or a file left out) is read again.
  if (!sameCode(code, change.files)) {
    const statics = readStatics(code);
    const had = readStatics(now).art;
    const drawn = new Set(Object.values(o.world.cast).filter((s) => s.art).map((s) => s.key));
    manifest = manifestOf(statics, { drawn, dials: o.world.dials });
    newArt = Object.keys(statics.art).filter((k) => !had[k]);
  }
  return { code, manifest, newArt, files: changedPaths(now, code), leftOut, handFile: handEditFile(now, code) };
}
