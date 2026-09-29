/**
 * The rig worker's client on its own (§8.2): `./rig` re-exports it too, but that barrel brings the whole
 * rig core (fitting, binding, posing, the preview), which the worker runs itself. Screens that only send
 * work to the worker (the Trail's walk strips) import it from here.
 */
export { rigWorker } from '../rig/worker/client';
