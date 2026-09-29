/**
 * A drawing's bones as data (§8.2): reading (`parseRig`) and fingerprinting (`hashRig`) a RigData, without
 * the rig core. `./rig` re-exports both, but that barrel brings fitting, binding and posing with it; the
 * Trail only reads the bones its walkers were baked with.
 */
export { parseRig } from '../rig/format';
export { hashRig } from '../rig/hash';
