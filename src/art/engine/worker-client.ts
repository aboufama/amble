/**
 * The main-thread side of the engine worker: one shared worker per page, request/response by id, with an
 * in-thread fallback running the same code when workers are unavailable (or fail to start).
 */
import { AnalysisCache, type WorkerRequest, type WorkerResponse, handle } from './worker-core';

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };

export class EngineWorker {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private local = new AnalysisCache();
  /** Lines-analysis keys the worker holds (so fills can skip resending the walls). */
  readonly known = new Set<string>();

  constructor(useWorker = typeof Worker !== 'undefined') {
    if (!useWorker) return;
    try {
      const w = new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; res?: WorkerResponse; error?: string }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.res) p.resolve(e.data.res);
        else p.reject(new Error(e.data.error ?? 'worker error'));
      };
      w.onerror = (e) => {
        e.preventDefault();
        this.fallBack(new Error(e.message || 'worker failed'));
      };
      this.worker = w;
    } catch {
      this.worker = null;
    }
  }

  get threaded(): boolean {
    return this.worker !== null;
  }

  private fallBack(err: Error): void {
    this.worker?.terminate();
    this.worker = null;
    this.known.clear();
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  call(req: WorkerRequest, transfer: Transferable[] = []): Promise<WorkerResponse> {
    if (!this.worker) return handle(req, this.local).then((r) => r.res);
    const id = this.nextId++;
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, req }, transfer);
    });
  }

  terminate(): void {
    this.fallBack(new Error('worker terminated'));
  }
}

let shared: EngineWorker | null = null;

/** The page's engine worker (created on first use). */
export function engineWorker(): EngineWorker {
  shared ??= new EngineWorker();
  return shared;
}
