/**
 * What the kit needs from the runtime shell. The shell creates one KitEnv per game realm and hands it to
 * `installKit`; kit modules read it through `env()`.
 */
import type { Action, ErrorPhase, FromPlayer, PlayerPrefs } from '../../play/protocol';
import type { AudioHub } from '../shell/audio';
import type { DrawnStore } from '../shell/assets';
import type { FlashLimiter } from '../shell/flash';
import type { MemoryStorage } from '../shell/storage';
import type { DialRegistry } from './dials';

export interface VirtualInput {
  /** Actions held by the touch overlay or the robot bot. */
  actions: Partial<Record<Action, boolean>>;
  /** The touch stick, -1..1, or null when it is not held. */
  stick: { x: number; y: number } | null;
}

export interface ReportOptions {
  /** The error came from a twist's code (the editor offers to switch it off). */
  twist?: string;
  /** false: report it but keep the game running (default true: the simulation stops). */
  crash?: boolean;
}

export interface KitEnv {
  mode: 'play' | 'robot';
  /** An exported page (no editor): tags say only the name, nothing is posted. */
  standalone: boolean;
  /** Skip the title card (robot tests and "Run it"). */
  autostart: boolean;
  /** Live: the shell updates it when the editor changes prefs. */
  prefs: PlayerPrefs;
  /** Real time in ms (the manual clock in a robot test). */
  now(): number;
  post(msg: FromPlayer): void;
  report(err: unknown, phase: ErrorPhase, o?: ReportOptions): void;
  crashed(): boolean;
  /** Clears a crash (the level restarts). */
  recover(): void;
  drawn: DrawnStore;
  /** The student's recordings, by name. */
  sounds: Map<string, AudioBuffer>;
  flash: FlashLimiter;
  audio: AudioHub;
  storage: MemoryStorage;
  /** Dials live across level restarts. */
  dials: DialRegistry;
  twistsOn: Set<string>;
  input: VirtualInput;
  /** Tells the touch overlay which buttons the game needs. */
  touchActions(actions: Action[], labels: Partial<Record<Action, string>>): void;
  /** The editor paused the game (loop asleep): stand-ins show their tags. */
  paused(): boolean;
  /** WebGL draw calls in the last frame (0 on the Canvas renderer). */
  drawCalls(): number;
}

let current: KitEnv | null = null;

export function setEnv(e: KitEnv): void {
  current = e;
}

export function env(): KitEnv {
  if (!current) throw new Error('The Amble kit is not installed.');
  return current;
}
