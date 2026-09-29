/**
 * `bindRig` for pages where drawings arrive without the editor's bake: part of the standalone script
 * (src/runtime/standalone.ts) that a shared web page appends to the runtime. The player's runtime reads
 * it from `BINDER_GLOBAL` when it has to bind by itself; in the editor every drawing arrives baked, so
 * games never download this.
 */
import { bindRig } from '../bind';
import type { BoundRig, RigData, RigInput } from '../types';
import { BINDER_GLOBAL } from './contract';

(globalThis as unknown as Record<string, unknown>)[BINDER_GLOBAL] = (input: RigInput, rig: RigData): BoundRig => bindRig(input, rig);
