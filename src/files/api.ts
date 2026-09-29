/**
 * `.amble` files, Save to Drive, open, share and the old-Amble rescue (§4.6, §4.7, §8.4; M6 owns).
 * FOUNDATION-STUB: every action throws `NotBuiltYet`, except `legacy.find` (null: nothing found) and
 * `legacy.dismiss`, which the Trail calls at boot.
 */
import type { LegacyImport } from '../legacy/reader';
import { NotBuiltYet } from '../model/notBuilt';
import type { AmbleFile, ArtId, FileProblemKind, World, WorldId } from '../model/types';

export interface FilesApi {
  /** null = cancelled. */
  saveWorld(world: World, o?: { saveAs?: boolean; name?: string }): Promise<{ name: string; at: number; method: 'fs-access' | 'download' } | null>;
  /** A kind 'drawing' .amble. */
  saveDrawing(artId: ArtId): Promise<void>;
  /** The flat PNG. */
  savePicture(artId: ArtId): Promise<void>;
  openPicker(o: { multiple: boolean }): Promise<File[]>;
  /** Gallery: every *.amble in a directory (read-only). */
  openFolder(): Promise<File[]>;
  /** Validates (§4.6); throws FileProblem. */
  read(file: Blob, o?: { manifestOnly?: boolean }): Promise<AmbleFile>;
  /** Stores a new world (always a new id). */
  importWorld(f: AmbleFile, o: { asCopy: boolean }): Promise<WorldId>;
  write(world: World, kind: 'world' | 'assignment'): Promise<Blob>;
  /** One .html via buildStandaloneHtml. */
  sharePage(world: World): Promise<Blob>;
  /** A zip of every world's .amble. */
  saveAll(): Promise<Blob>;
  legacy: { find(): Promise<LegacyImport | null>; bring(l: LegacyImport): Promise<WorldId>; dismiss(): Promise<void> };
}

/** Why a file could not be opened; `message` is the student-facing copy (§2.16). */
export class FileProblem extends Error {
  readonly kind: FileProblemKind;

  constructor(kind: FileProblemKind, message: string) {
    super(message);
    this.name = 'FileProblem';
    this.kind = kind;
  }
}

export function createFilesStub(): FilesApi {
  const notYet = (what: string) => () => Promise.reject(new NotBuiltYet(`FilesApi.${what} (M6)`));
  return {
    saveWorld: notYet('saveWorld'),
    saveDrawing: notYet('saveDrawing'),
    savePicture: notYet('savePicture'),
    openPicker: notYet('openPicker'),
    openFolder: notYet('openFolder'),
    read: notYet('read'),
    importWorld: notYet('importWorld'),
    write: notYet('write'),
    sharePage: notYet('sharePage'),
    saveAll: notYet('saveAll'),
    legacy: {
      find: () => Promise.resolve(null),
      bring: notYet('legacy.bring'),
      dismiss: () => Promise.resolve(),
    },
  };
}
