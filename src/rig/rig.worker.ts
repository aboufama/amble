/**
 * The rig worker: auto-rig, bind (as transferable bakes) and filmstrips off the main thread. Started by
 * `createRigWorker()`; it answers one request at a time, in order.
 */
import { createRigCore } from './worker/core';
import type { WorkerAnswer, WorkerCall } from './worker/protocol';

const core = createRigCore();
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerCall>) => void) | null;
  postMessage(message: WorkerAnswer, options?: { transfer?: Transferable[] }): void;
};

let queue: Promise<void> = Promise.resolve();

scope.onmessage = (e) => {
  const { id, request } = e.data;
  queue = queue.then(async () => {
    try {
      const { response, transfer } = await core.handle(request);
      scope.postMessage({ id, ok: true, response }, { transfer });
    } catch (err) {
      scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
};
