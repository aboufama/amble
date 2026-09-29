/**
 * The app's handle on the rig worker: promises for auto-rig, bind and filmstrips. Requests run in
 * order; a request in a named `lane` replaces the lane's waiting request (latest wins: a stream of
 * joint drags binds only the newest bones), and the replaced promise rejects with `superseded`.
 * Without a worker (tests, a CSP that blocks it) the same code runs inline.
 */
import { unbakeBound } from '../bake';
import type { BindOptions } from '../bind';
import type { BoundRig, CharacterKind, RigData } from '../types';
import { createRigCore, type RigCore } from './core';
import type { AutoRigRequest, RefitRequest, RigReply, RigRequest, RigResponse, RigSource, StripMeta, WorkerAnswer, WorkerCall } from './protocol';

export class RigWorkerError extends Error {
  constructor(message: string, readonly superseded = false) {
    super(message);
    this.name = 'RigWorkerError';
  }
}

export interface LaneOption {
  /** Latest wins within a lane: a newer request replaces one still waiting. */
  lane?: string;
}

export interface RigWorkerApi {
  /** Bones for a drawing (the kind comes from the caller, never a guess). */
  autoRig(input: RigSource, req: AutoRigRequest & LaneOption): Promise<RigReply>;
  /** The drawing cut into parts, meshed and weighted for these bones. */
  bind(input: RigSource, rig: RigData, opts?: BindOptions & LaneOption): Promise<BoundRig>;
  /** Like `bind`, as one transferable buffer (cache it, or send it to the player). */
  bake(input: RigSource, rig: RigData, opts?: BindOptions & LaneOption): Promise<ArrayBuffer>;
  /** Bones and bind in one round trip (Bring to life). */
  rigAndBind(input: RigSource, req: AutoRigRequest & LaneOption, opts?: BindOptions): Promise<RigReply & { bound: BoundRig; bake: ArrayBuffer }>;
  /** "What is it?": re-fit as another kind. */
  setKind(input: RigSource, rig: RigData, kind: CharacterKind, req?: RefitRequest & LaneOption): Promise<RigReply>;
  /** "Magic bones": a fresh auto-rig (optionally keeping the current joints, or with vision hints). */
  magicBones(input: RigSource, rig: RigData, req?: RefitRequest & LaneOption): Promise<RigReply>;
  /** A move as frames (ImageBitmaps), e.g. walk strips for the Trail. `packed` gives one strip image. */
  strip(input: RigSource, rig: RigData, clip: string, opts?: { frames?: number; size?: number; face?: 1 | -1; packed?: boolean } & LaneOption): Promise<{ meta: StripMeta; frames: ImageBitmap[] }>;
  /** Forget cached analyses and bakes. */
  clear(): Promise<void>;
  terminate(): void;
}

interface Job {
  request: RigRequest;
  resolve: (r: RigResponse) => void;
  reject: (e: Error) => void;
  lane?: string;
}

export interface RigWorkerOptions {
  /** A worker to use, or null to run inline. Default: a module worker from `rig.worker.ts`. */
  worker?: Worker | null;
}

function spawn(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('../rig.worker.ts', import.meta.url), { type: 'module', name: 'amble-rig' });
  } catch {
    return null;
  }
}

class Client implements RigWorkerApi {
  private worker: Worker | null;
  private core: RigCore | null = null;
  private nextId = 1;
  private readonly calls = new Map<number, Job>();
  private busy = false;
  private readonly queue: Job[] = [];

  constructor(opts: RigWorkerOptions) {
    this.worker = opts.worker === undefined ? spawn() : opts.worker;
    if (this.worker) {
      this.worker.onmessage = (e: MessageEvent<WorkerAnswer>) => this.answer(e.data);
      this.worker.onerror = (e) => {
        // the worker could not start or crashed: finish the work inline from now on
        e.preventDefault?.();
        this.worker?.terminate();
        this.worker = null;
        const lost = [...this.calls.values()];
        this.calls.clear();
        this.busy = false;
        this.queue.unshift(...lost);
        this.pump();
      };
    }
  }

  private answer(a: WorkerAnswer): void {
    const job = this.calls.get(a.id);
    this.calls.delete(a.id);
    this.busy = false;
    if (job) {
      if (a.ok && a.response) job.resolve(a.response);
      else job.reject(new RigWorkerError(a.error ?? 'The rig worker failed'));
    }
    this.pump();
  }

  private pump(): void {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    if (this.worker) {
      const id = this.nextId++;
      this.calls.set(id, job);
      const call: WorkerCall = { id, request: job.request };
      this.worker.postMessage(call);
      return;
    }
    this.core ??= createRigCore();
    // yield first, so an inline run never blocks the caller's frame
    setTimeout(() => {
      this.core!.handle(job.request).then(
        (r) => {
          this.busy = false;
          job.resolve(r.response);
          this.pump();
        },
        (e: unknown) => {
          this.busy = false;
          job.reject(e instanceof Error ? e : new RigWorkerError(String(e)));
          this.pump();
        },
      );
    }, 0);
  }

  private run<T extends RigResponse['op']>(request: RigRequest, lane?: string): Promise<Extract<RigResponse, { op: T }>> {
    return new Promise((resolve, reject) => {
      const job: Job = { request, resolve: resolve as (r: RigResponse) => void, reject, lane };
      if (lane) {
        const i = this.queue.findIndex((j) => j.lane === lane);
        if (i >= 0) {
          this.queue[i].reject(new RigWorkerError('A newer request replaced this one', true));
          this.queue.splice(i, 1);
        }
      }
      this.queue.push(job);
      this.pump();
    });
  }

  async autoRig(input: RigSource, req: AutoRigRequest & LaneOption): Promise<RigReply> {
    const { lane, ...r } = req;
    return (await this.run<'autoRig'>({ op: 'autoRig', input, req: r }, lane)).reply;
  }

  async bake(input: RigSource, rig: RigData, opts: BindOptions & LaneOption = {}): Promise<ArrayBuffer> {
    const { lane, ...o } = opts;
    return (await this.run<'bind'>({ op: 'bind', input, rig, opts: o }, lane)).bake;
  }

  async bind(input: RigSource, rig: RigData, opts: BindOptions & LaneOption = {}): Promise<BoundRig> {
    return unbakeBound(await this.bake(input, rig, opts));
  }

  async rigAndBind(input: RigSource, req: AutoRigRequest & LaneOption, opts: BindOptions = {}): Promise<RigReply & { bound: BoundRig; bake: ArrayBuffer }> {
    const { lane, ...r } = req;
    const res = await this.run<'rigAndBind'>({ op: 'rigAndBind', input, req: r, opts }, lane);
    // the bound rig reads from its own copy, so the bake stays free to store or send
    return { ...res.reply, bake: res.bake, bound: unbakeBound(res.bake.slice(0)) };
  }

  async setKind(input: RigSource, rig: RigData, kind: CharacterKind, req: RefitRequest & LaneOption = {}): Promise<RigReply> {
    const { lane, ...r } = req;
    return (await this.run<'setKind'>({ op: 'setKind', input, rig, kind, req: r }, lane)).reply;
  }

  async magicBones(input: RigSource, rig: RigData, req: RefitRequest & LaneOption = {}): Promise<RigReply> {
    const { lane, ...r } = req;
    return (await this.run<'magicBones'>({ op: 'magicBones', input, rig, req: r }, lane)).reply;
  }

  async strip(input: RigSource, rig: RigData, clip: string, opts: { frames?: number; size?: number; face?: 1 | -1; packed?: boolean } & LaneOption = {}): Promise<{ meta: StripMeta; frames: ImageBitmap[] }> {
    const { lane, ...o } = opts;
    const r = await this.run<'strip'>({ op: 'strip', input, rig, clip, opts: o }, lane);
    return { meta: r.meta, frames: r.frames };
  }

  async clear(): Promise<void> {
    await this.run<'clear'>({ op: 'clear' });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const j of [...this.calls.values(), ...this.queue]) j.reject(new RigWorkerError('The rig worker was stopped'));
    this.calls.clear();
    this.queue.length = 0;
    this.busy = false;
  }
}

/** A new rig worker client (each owns its worker and caches). */
export function createRigWorker(opts: RigWorkerOptions = {}): RigWorkerApi {
  return new Client(opts);
}

let shared: RigWorkerApi | null = null;

/** The app's shared rig worker, started on first use. */
export function getRigWorker(): RigWorkerApi {
  return (shared ??= createRigWorker());
}

/** The shared rig worker as an object (`rigWorker.autoRig(...)`), started on first use. */
export const rigWorker: RigWorkerApi = {
  autoRig: (...a) => getRigWorker().autoRig(...a),
  bind: (...a) => getRigWorker().bind(...a),
  bake: (...a) => getRigWorker().bake(...a),
  rigAndBind: (...a) => getRigWorker().rigAndBind(...a),
  setKind: (...a) => getRigWorker().setKind(...a),
  magicBones: (...a) => getRigWorker().magicBones(...a),
  strip: (...a) => getRigWorker().strip(...a),
  clear: () => getRigWorker().clear(),
  terminate: () => {
    shared?.terminate();
    shared = null;
  },
};
