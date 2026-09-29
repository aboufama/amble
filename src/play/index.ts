/**
 * The player core, host side: everything the editor needs to run games in the sandbox.
 * The runtime's URL comes from `./runtimeUrl` (a Vite virtual module), kept out of this index.
 */
export { Player, type GameBundle, type PlayerEvents, type PlayerOptions, type PlayerState } from './player';
export { PlayerFrame, type FrameEvents, type FrameOptions } from './frame';
export { runRobotTest, type RobotTestOptions } from './robot';
export { judgeRobot, ROBOT_THRESHOLDS, type RobotReport, type RobotThresholds } from './robotJudge';
export { buildStandaloneHtml, standaloneCsp, type StandaloneInput } from './standalone';
export { loadRuntime, loadRuntimeText } from './runtimeBytes';
export { PLAYER_BOOT, STANDALONE_BOOT, playerCsp, playerSrcdoc, scriptHash } from './bootstrap';
export { isScrollKey, keyCodeFor, shouldForwardKey, type KeyLike } from './keys';
export { PLAYER_LIMITS, RateLimiter, type Limit } from './limits';
export * from './protocol';
// The kit's API as data and the model-facing d.ts (pure: no Phaser comes with them).
export {
  KIT_API,
  KIT_REFERENCE,
  type KitApi,
  type KitMember,
  type KitNamespace,
  type KitReference,
  type KitReferenceMember,
  type KitReferenceNamespace,
} from './kit/manifest';
export { kitDts } from './kit/dts';
