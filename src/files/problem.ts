/** Why a file could not be opened; `message` is the student-facing copy (§2.16). */
import type { FileProblemKind } from '../model/types';

export class FileProblem extends Error {
  readonly kind: FileProblemKind;

  constructor(kind: FileProblemKind, message: string) {
    super(message);
    this.name = 'FileProblem';
    this.kind = kind;
  }
}

export function isFileProblem(err: unknown): err is FileProblem {
  return err instanceof FileProblem;
}
