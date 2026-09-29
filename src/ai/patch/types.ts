/** The AMBLE PATCH envelope: how build, change and fix replies carry code (design-power §5.6). */

export type FileAction = 'create' | 'replace' | 'edit' | 'delete';

export interface Edit {
  /** Lines copied from the current file. */
  find: string;
  replace: string;
}

export type FileOp =
  | { action: 'create' | 'replace'; path: string; content: string }
  /** `malformed` lists edit blocks that couldn't be read (a find without a replace...); the file then fails as a whole. */
  | { action: 'edit'; path: string; edits: Edit[]; malformed: string[] }
  | { action: 'delete'; path: string };

export type SafetyStatus = 'ok' | 'toned-down' | 'refused' | 'crisis';

export interface Patch {
  /** From `@@amble-patch <version>`; null when the header never came. */
  version: number | null;
  summary: string;
  play: string;
  next: string[];
  safety: { status: SafetyStatus; note: string };
  /** Complete file blocks only. Empty when the reply refused or signalled a crisis. */
  ops: FileOp[];
  /** `@@end` arrived: nothing was cut off. */
  complete: boolean;
  /** The file whose block was cut off by truncation, if any (its partial text is not in `ops`). */
  truncatedIn: string | null;
  warnings: string[];
}

export type PatchEvent =
  | { type: 'start'; version: number }
  | { type: 'header'; name: 'summary' | 'play' | 'next' | 'safety' }
  | { type: 'file'; path: string; action: FileAction }
  /** A body line arrived: "Writing boss.js, 34 lines". */
  | { type: 'lines'; path: string; count: number }
  | { type: 'fileDone'; op: FileOp }
  | { type: 'end' };
