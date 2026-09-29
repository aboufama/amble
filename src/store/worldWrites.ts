/**
 * One read-change-write of a stored world at a time (§4.4). Bring to life, a build that lands while the student
 * draws, and an AI change for a world that is not open each read the stored world, change their part and
 * commit the whole world. Two of them overlapping would each commit their own copy, and the one written last
 * would drop the other's change (a drawing's cast slot, or the built game). `writeWorld(id, task)` runs `task`
 * once every earlier task for the same world has finished (worlds apart never wait for each other).
 *
 * A task must not start another `writeWorld` for the same world and wait for it: that would wait forever.
 */
import type { WorldId } from '../model/types';

const tails = new Map<WorldId, Promise<void>>();

export function writeWorld<T>(id: WorldId, task: () => Promise<T>): Promise<T> {
  const before = tails.get(id) ?? Promise.resolve();
  const run = before.then(task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(id, tail);
  void tail.then(() => {
    if (tails.get(id) === tail) tails.delete(id);
  });
  return run;
}
