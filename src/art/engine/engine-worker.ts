/** The art engine's worker entry: fill analysis, history packing and PNG encoding off the main thread. */
import { AnalysisCache, type WorkerRequest, handle } from './worker-core';

interface WorkerScope {
  onmessage: ((e: MessageEvent<{ id: number; req: WorkerRequest }>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const cache = new AnalysisCache();
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, req } = e.data;
  handle(req, cache).then(
    ({ res, transfer }) => scope.postMessage({ id, res }, transfer),
    (err: unknown) => scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) }),
  );
};
