/**
 * The rig core as the app sees it (§8.2): RigData v1 and its parser, auto-rig and bind through the rig
 * worker, templates and the Draw-on-the-bones steps, the pure editing API, the constellation drawing, the
 * Canvas 2D preview and the move list. Modules import rig APIs only from here.
 *
 * Over `src/rig` (the rig core), re-exported under its own names, which are the spec's. The Phaser adapter
 * (`src/rig/phaser`) is NOT exported here: it belongs to the player bundle only.
 *
 * Notes for modules:
 * - `rigWorker.autoRig(source, { kind, hints, tipHints, previous })`, `bind`, `bake`, `rigAndBind`,
 *   `setKind`, `magicBones` and `strip` run off the main thread (latest wins within a `lane`; superseded
 *   calls reject with `RigWorkerError.superseded`). A source is `{ image, layers? }` where an image can be
 *   Pixels, a PNG Blob or an ImageBitmap; pass the export's ink mask as `layers.lines` and part layers as
 *   `part:<name>` (names from `partSteps`).
 * - Replies are `{ rig, confidence, notes, issues }`: confidence below 0.6 means "Check the bones";
 *   `issues` are stable codes to put in the UI's own words; `notes` are English defaults.
 * - The editing API is pure (`(rig, ...) => RigData`; joint edits set `made: 'hand'`). `setKind` and
 *   `magicBones` also exist as main-thread functions over pixels (`(input, rig, ...) => { rig, ... }`),
 *   but the worker versions keep the page responsive.
 * - Joints are addressed by id (`armL2`, `armL2.tip`; see `jointList`). L and R mean screen left and right.
 * - `Facing` here is the rig's `1 | -1 | 0` (also exported as `RigFacing`); the protocol's `Facing` is
 *   'viewer' | 'right' | 'left'.
 */
export * from '../rig';
export type { Facing as RigFacing } from '../rig';

/** 'real' since the rig core merged. */
export const RIG_CORE: 'stub' | 'real' = 'real';
