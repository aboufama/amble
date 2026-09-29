/**
 * Thrown by a stub whose real implementation belongs to a module or core that has not landed yet.
 * INTEGRATION greps for `NotBuiltYet` and the `FOUNDATION-STUB` marker; both must be gone at the end.
 */
export class NotBuiltYet extends Error {
  readonly what: string;

  constructor(what: string) {
    super(`${what} is not built yet.`);
    this.name = 'NotBuiltYet';
    this.what = what;
  }
}

export function isNotBuiltYet(err: unknown): err is NotBuiltYet {
  return err instanceof NotBuiltYet;
}
