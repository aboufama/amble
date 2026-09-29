/**
 * Amble's rig engine: bones under the art. Finds bones in a student's drawing with no AI, binds the
 * drawing to them (cut-out between parts, skinning within parts) and animates it with procedural
 * moves. The Phaser adapter lives in `src/rig/phaser` (player bundle only).
 */
export * from './types';
export { RigFormatError, parseRig, tryParseRig, serializeRig, cloneRig, normalizeKind, DEFAULT_SPRING, type ParseResult } from './format';
export { hashPixels, hashRig, bindKey, BIND_VERSION } from './hash';
export { autoRig, confidenceOf, type AutoRigOptions, type AutoRigResult, type RigResult } from './autorig';
export type { FitIssue } from './fit/common';
export { bindRig, bindScale, BIND_WORK_SIZE, defaultParts, type BindOptions } from './bind';
export { bakeBound, unbakeBound, isBake, BAKE_VERSION } from './bake';
export {
  jointList, findJoint, moveJoint, moveBone, mirrorSides, addDynamic, removeBone, setRigid, setDynamic, setFacing, setAnchor,
  setTweak, setKind, magicBones, rigForRedraw, hintsFromRig, spineAxis, sideOf, artSizeOf, scaleRigTo,
  type Joint, type JointEnd, type Side, type WigglyOptions, type RefitOptions,
} from './editing';
export { templateFor, templateHints, ghostShapes, partSteps, type GhostShape, type PartStep } from './templates';
export { hintsFromVision, visionSilhouette, type VisionReply, type VisionJointName, type HintSet } from './hints';
export { clipsFor, clipMap, resolveClip } from './clips/library';
export type { Clip } from './clips/ctx';
export { Pose } from './runtime/pose';
export { Skeleton, skinVertices } from './runtime/skeleton';
export { Animator, type PlayOptions, type AnimatorOptions } from './runtime/animator';
export { RigPuppet, type BodyLike, type FollowSpeeds, type PuppetUpdate } from './runtime/puppet';
export {
  makeCanvas, context2d, pixelsToCanvas, atlasCanvas, drawVertices, vertexBounds, drawRigged, drawPuppet,
  type DrawOptions, type AnyCanvas, type Ctx2D,
} from './render/canvas';
export { drawBones, bonePointsOf, restBonePoints, boneSide, BONE_COLOURS, type BonesStyle } from './render/bones';
export { renderClipFrames, renderContactSheet, packStrip, sampleClip, type ClipFrameOptions, type ClipStrip, type ClipSamples, type ContactSheetOptions } from './render/frames';
export { createRigPreview, type RigPreview, type RigPreviewOptions } from './render/preview';
export { rigWorker, createRigWorker, getRigWorker, RigWorkerError, type RigWorkerApi, type RigWorkerOptions, type LaneOption } from './worker/client';
export type { RigSource, ImageSource, AutoRigRequest, RigReply, RefitRequest, StripMeta } from './worker/protocol';
