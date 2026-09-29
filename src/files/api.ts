/**
 * `.amble` files, Save to Drive, open, share and the old-Amble rescue (§4.6, §4.7, §8.4; M6 owns).
 * The interface lives here; `createFiles` (service.ts) implements it.
 */
import type { LegacyImport } from '../legacy/reader';
import type { AmbleFile, ArtId, World, WorldId } from '../model/types';
import type { PickedFile, SaveKind } from './fsAccess';

export { FileProblem, isFileProblem } from './problem';
export type { PickedFile, SaveKind } from './fsAccess';

export type SaveMethod = 'fs-access' | 'download';

export interface SavedFile {
  name: string;
  at: number;
  method: SaveMethod;
}

export interface FilesApi {
  /** null = cancelled. */
  saveWorld(world: World, o?: { saveAs?: boolean; name?: string }): Promise<SavedFile | null>;
  /** A kind 'drawing' .amble. */
  saveDrawing(artId: ArtId): Promise<void>;
  /** The flat PNG. */
  savePicture(artId: ArtId): Promise<void>;
  openPicker(o: { multiple: boolean }): Promise<File[]>;
  /** Gallery: every *.amble in a directory (read-only). */
  openFolder(): Promise<File[]>;
  /** Validates (§4.6); throws FileProblem. */
  read(file: Blob, o?: { manifestOnly?: boolean }): Promise<AmbleFile>;
  /** Stores a new world (always a new id). `fileName` names the import footstep. */
  importWorld(f: AmbleFile, o: { asCopy: boolean; fileName?: string }): Promise<WorldId>;
  write(world: World, kind: 'world' | 'assignment'): Promise<Blob>;
  /** One .html via buildStandaloneHtml. */
  sharePage(world: World): Promise<Blob>;
  /** A zip of every world's .amble. */
  saveAll(): Promise<Blob>;
  legacy: {
    find(): Promise<LegacyImport | null>;
    /** Brings the drawings and sounds into a new world; resolves with its id. */
    bring(l: LegacyImport): Promise<WorldId>;
    /** "Not now": never asks again for this old project. */
    dismiss(l?: LegacyImport | null): Promise<void>;
  };
  /** An addition: saves any blob through the save picker or a download (the Save all zip, a CSV, a shared page). */
  saveBlob(make: Blob | (() => Promise<Blob>), name: string, kind: SaveKind): Promise<{ name: string; method: SaveMethod } | null>;
  /** An addition: when and how a world was last saved to a file ("Last saved to Drive 10:42"). */
  lastSaved(worldId: WorldId): Promise<SavedFile | null>;
  /** An addition: imports a drawing file (kind 'drawing') onto the Trail; resolves with the new ids. */
  importDrawing(f: AmbleFile): Promise<ArtId[]>;
  /** An addition: the handle the open picker returned for a file (kept so Save to Drive overwrites it). */
  handleOf(file: File): FileSystemFileHandle | null;
  /** An addition: the open picker, with the handles. */
  pick(multiple: boolean): Promise<PickedFile[]>;
  /** An addition: Share as a web page, saved through the picker or as a download ("Moon King (web page).html"). */
  saveSharePage(world: World): Promise<{ name: string; method: SaveMethod } | null>;
}

export { createFiles } from './service';
export { startFilesUpkeep } from './upkeep';
