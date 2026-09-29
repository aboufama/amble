// What build.mjs needs from the app's source, bundled for Node by esbuild (never part of the app).
export { STARTERS } from '../../../src/starters/catalog';
export { buildArt, partPairs } from '../../../src/starters/assets/build';
export { bindRig, parseRig, serializeRig } from '../../../src/cores/rig';
export { validateArtScript, encodePng } from '../../../src/cores/art';
export { validateGame } from '../../../src/ai/validate/validate';
export { KIT_API } from '../../../src/play/kit/manifest';
