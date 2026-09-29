/**
 * The app's data model (SPEC §4.2), written exactly as specified. A leaf module: it imports types only,
 * from the core barrels (src/cores) and from src/audio. Later changes go through INTEGRATION.
 *
 * The protocol and rig types come through src/cores/play.ts and src/cores/rig.ts (the spec names
 * src/play/protocol and src/rig/types; the barrels re-export them, so a core rename is fixed in one place).
 */
import type { Role, ArtKind, RigKind, ArtShape, Facing, Pronoun, Action, DialSpec, GameManifest, ArtNeed,
  PlayerError } from '../cores/play';
import type { RigData, CharacterKind } from '../cores/rig';
import type { SynthRecipe } from '../audio/synth';
import type { SoundEffect } from '../audio/effects';
export type { Role, ArtKind, RigKind, ArtShape, Facing, Pronoun, Action, DialSpec, GameManifest, ArtNeed, PlayerError, RigData, CharacterKind };
// AiConfig stays in src/ai (the core) and is imported by the config slice directly.

// ------------------------------------------------------------------ ids and small types
export type Id = string;                        // uid(prefix): prefix + 10 crypto-random base36 chars ('w_', 'a_', 's_', 'g_')
export type WorldId = Id; export type ArtId = Id; export type StepId = Id;
export type BlobRef = `sha256:${string}`;       // content address of a Blob in the 'blobs' store
export type CastKey = string;                   // /^[a-z][A-Za-z0-9]{0,23}$/: the key game code uses (spawn(x, y, 'moonKing'))
export type Level = 'elementary' | 'middle' | 'high';
export type AiMode = 'on' | 'explain' | 'off';
export type Author = 'starter' | 'ai' | 'student' | 'teacher';
export type AuthorRun = [Author, number];       // run-length provenance: [['starter', 40], ['ai', 12], ['student', 3]]
export type LineRange = [number, number];       // 1-based, inclusive
export type StarterId = 'moon-king' | 'sky-run' | 'wobble-tower' | 'lantern-maze' | 'clanks-climb';
export type SeedId = StarterId | 'parade';
export type TwistId = string;                   // ids come from the kit ('moonGravity', 'gravityFlips', ...)

// ------------------------------------------------------------------ the world (one game)
export interface World {
  format: 'amble-world'; version: 1;
  id: WorldId;
  title: string;                                // ≤ 40
  pitch: string;                                // the student's idea in their words (≤ 300); '' for starters
  level: Level;                                 // content level the world was made at
  createdAt: number; updatedAt: number; openedAt: number;
  origin: WorldOrigin;
  code: CodeFile[];                             // helpers first (alphabetical), 'game.js' last; ≤ 8 files
  cast: Record<CastKey, CastSlot>;              // which drawing plays which key, plus extra (resting) members
  sounds: Record<string, SoundPiece>;           // overrides of game sound names ('coin', 'roar')
  dials: Record<string, number>;                // student values over the game's defaults
  twists: TwistId[];                            // twists switched on
  controls: Partial<Record<Action, string[]>>;  // remapped keys
  gameStorage: Record<string, string>;          // the game's localStorage shim (high scores); ≤ 64 KB
  steps: StepSummary[];                         // Footsteps index, oldest first; snapshots live in the 'steps' store
  head: StepId;                                 // the step the world is at now
  assignment: Assignment | null;
  handIn: HandInState;
  credits: { madeBy: string };                  // initials or a nickname (≤ 20), asked only at Hand in; never a real-name prompt
  plan: PlanReply | null;                       // the last AI plan (idea chips, Warm-up, the ladder)
}
export type WorldOrigin =
  | { kind: 'starter'; starter: StarterId; withArt: boolean }   // withArt false = a seed ("Give Blorp a world")
  | { kind: 'plan'; starter: StarterId; planTitle: string }     // an AI plan; starter = the build's base and the ladder's fallback
  | { kind: 'assignment'; assignmentId: Id; starter: StarterId | null }
  | { kind: 'file'; fileName: string }
  | { kind: 'parade' }                                          // characters without a world yet, and old-Amble imports
  | { kind: 'import-v1'; title: string };
export interface CodeFile {
  path: string;                                 // /^[a-z][a-z0-9-]{0,23}\.js$/; 'game.js' is required
  source: string;
  authors: AuthorRun[];                         // one run per line block; sums to the file's line count
  locked: LineRange[];                          // lines a teacher locked (read-only in Look inside; the AI may not change them)
}
export interface CastSlot {
  key: CastKey;
  art: ArtId | null;                            // null = "just bones"
  madeBy: 'student' | 'example' | 'teacher' | 'import' | null;
  extra: CastExtra | null;                      // set when the code does not declare this key: an added or resting member
  laterUntil: number;                           // the request tag's "Later" (epoch ms); 0 = not snoozed
}
export interface CastExtra { name: string; role: Role; kind: ArtKind; rig: RigKind; note: string }

/** The Cast as the UI shows it. Derived by deriveCast(manifest, world); never stored. */
export interface CastMember {
  key: CastKey; name: string; kind: ArtKind; role: Role; rig: RigKind; shape: ArtShape;
  ask: string; about: string; pronoun: Pronoun; facing: Facing;
  w: number; h: number;                         // in-game size (game px): hitbox, placeholder, scale reference
  priority: number; required: boolean; spare: boolean;
  art: ArtId | null;
  status: 'drawn' | 'needed' | 'optional' | 'spare' | 'resting';
  onScreen: boolean;                            // the running game has shown it (ArtNeed.used)
  count: number;                                // live instances in the last objects report (for "×3")
}

/** The Trail's index: small, read first. Derived from the world on every commit. */
export interface WorldMeta {
  id: WorldId; title: string; createdAt: number; updatedAt: number; openedAt: number;
  snapshot: BlobRef | null;                     // 320x180 frame taken when the student leaves the world
  hero: ArtId | null;                           // the drawing that plays 'hero' (sign sticker and cover)
  walkers: ArtId[];                             // up to 2 drawn characters that walk under the sign
  drawn: number; needed: number;                // "4 of 6 drawn"
  bytes: number;
  origin: WorldOrigin['kind'];
  assignment: { title: string; due: string } | null;
  handedIn: number | null;
  putAwayAt: number | null;                     // Lost and found (purged after 30 days)
}

// ------------------------------------------------------------------ drawings
export interface ArtRecord {
  id: ArtId;
  name: string;                                 // "Moon King", "Blorp"
  kind: ArtKind; rig: RigKind; facing: Facing; role: Role | null;
  mode: 'bones' | 'free';                       // drawn on the bones (part layers) or freehand
  board: { w: number; h: number; pixelArt: boolean };
  doc: BlobRef;                                 // the core's serialized ArtDoc JSON (layers, roles, frames, pivot, guide, cel refs)
  cels: BlobRef[];                              // every cel PNG that doc references (for GC and files)
  parts: Record<string, PartLayers>;            // bones mode: part name ('armL', 'head') → its layer pair
  export: ArtExport | null;                     // what games load; null until the first Bring to life
  rigData: RigData | null;                      // the bones (characters only)
  rigInfo: { made: 'auto' | 'guide' | 'parts' | 'ai' | 'hand'; confidence: number; notes: string[] } | null;
  palette: string[];                            // ≤ 24 colours used (feeds "From your world")
  madeBy: 'student' | 'example' | 'teacher' | 'import';
  shelf: boolean;                               // a free drawing that walks the Trail ("My characters")
  createdAt: number; updatedAt: number;
  version: number;                              // +1 on every Bring to life
}
export interface PartLayers { lines: string; colors: string }   // layer ids inside the ArtDoc
export interface ArtExport {
  hash: string;                                 // sha256 of the flat PNG (the rig's artHash input)
  flat: BlobRef; w: number; h: number;          // trimmed composite at 2x in-game size, ≤ 1024 on the long side (backgrounds ≤ 1920x1080)
  anchor: [number, number];                     // pivot in flat px: feet centre for walkers, centre for items, top-centre for platforms
  inkMask: BlobRef | null;                      // union of the Lines layers (the rig's exact ink mask)
  parts: Record<string, { blob: BlobRef; x: number; y: number; w: number; h: number }>;   // 'part:<name>' composites (lines + colours)
  sticker: BlobRef;                             // 256 px with the 3 px cream die-cut edge (UI only, never in games)
  thumb: BlobRef;                               // 128 px
  frames: { atlas: BlobRef; json: string; move: string; fps: number } | null;   // a flipbook that replaces one move
}
export type ArtRecordLite = Pick<ArtRecord, 'id' | 'name' | 'kind' | 'rig' | 'shelf' | 'updatedAt'> & { sticker: BlobRef | null };
export interface DeskDraft {
  artId: ArtId; worldId: WorldId | null; castKey: CastKey | null;
  doc: string;                                  // serialized ArtDoc JSON with draft cel refs
  cels: Record<string, Blob>;                   // dirty cels only
  tool: string; at: number;
}

// ------------------------------------------------------------------ sounds
export interface SoundPiece {
  name: string;                                 // the game's sound name
  source:
    | { kind: 'preset'; preset: string; variation: 0 | 1 | 2 }
    | { kind: 'synth'; recipe: SynthRecipe }
    | { kind: 'recording'; blob: BlobRef; mime: 'audio/wav' | 'audio/webm'; duration: number };
  effects: SoundEffect[];
  caption: string;                              // "[boss roars]" (captions)
  madeBy: 'student' | 'example';
}

// ------------------------------------------------------------------ Footsteps
export type StepKind = 'start' | 'draw' | 'redraw' | 'bones' | 'dials' | 'twists' | 'code' | 'ask' | 'fix'
  | 'goback' | 'sound' | 'cast' | 'import' | 'handin' | 'refused';
export interface StepSummary {
  id: StepId; at: number;
  by: 'student' | 'ai' | 'auto' | 'teacher';    // auto = Amble fixed a small bug by itself
  kind: StepKind;
  text: string;                                 // "You turned Jump height up to 820."
  request?: string;                             // the student's words (AI steps); local, never sent back to the AI
  files?: string[]; cast?: CastKey; lines?: number;
  tested?: boolean;                             // passed the robot test
  handEdits?: boolean;                          // the AI changed lines the student wrote
}
export interface StepInput { kind: StepKind; by: StepSummary['by']; text: string; request?: string; cast?: CastKey; files?: string[]; tested?: boolean; handEdits?: boolean }
export interface StepSnapshot {
  id: StepId; worldId: WorldId;
  code: CodeFile[];
  cast: Record<CastKey, CastSlot>;
  art: Record<ArtId, { version: number; doc: BlobRef; cels: BlobRef[]; export: ArtExport | null; rigData: RigData | null }>;
  sounds: Record<string, SoundPiece>;
  dials: Record<string, number>;
  twists: TwistId[];
}
export interface StepDiff {
  files: Array<{ path: string; hunks: string }>;          // unified diff, ±3 lines of context
  drawings: Array<{ key: CastKey; before: BlobRef | null; after: BlobRef | null }>;
  dials: Array<{ key: string; before: number; after: number }>;
}

// ------------------------------------------------------------------ school
export interface Assignment {
  id: Id; title: string; text: string;          // ≤ 60 / ≤ 400
  starter: StarterId | null;                    // null = a custom world carried in an assignment file
  require: CastKey[];                           // drawings the student must make
  goals: Goal[];
  ai: AiMode;                                   // lowers, never raises, the class setting
  level: Level | null;                          // lowers, never raises
  due: string;                                  // display text only ("Friday")
  locked: Record<string, LineRange[]>;          // path → locked lines (custom worlds)
}
export type Goal = { id: Id; label: string } & ({ kind: 'teacher' } | { kind: 'auto'; check: AutoCheck });
export type AutoCheck =
  | { type: 'drawn'; key: CastKey }             // drawn, and madeBy 'student'
  | { type: 'min-drawings'; n: number }
  | { type: 'runs-clean' }                      // a fresh 6 s robot test with no errors
  | { type: 'boss-attacks'; min: number }       // distinct pattern.* / shoot calls reachable from the boss's brain or phases
  | { type: 'uses-dials'; min: number }
  | { type: 'has-win-and-lose' }
  | { type: 'brain-states'; min: number }
  | { type: 'captions' };                       // every sound the game uses has a caption
export interface CheckResult { goal: Id; pass: boolean; evidence: string }   // "3 found in your code", "tested just now"
export interface HandInState { fileName: string | null; savedAt: number | null; method: 'fs-access' | 'download' | null; turnedInAt: number | null }

/** The class link payload: `#class=<base64url(JSON)>`, ≤ 2 KB. */
export interface ClassLinkV1 {
  v: 1;
  cls: string;                                  // "Room 12 · Period 3" (≤ 40)
  district: string | null;                      // "SAU 99"
  ai: {
    baseUrl: string;                            // https only (http://localhost in dev)
    model: string; fastModel?: string; visionModel?: string;
    caps?: string;                              // "json_schema,stream,reasoning,vision,moderation"
    auth: { type: 'class-code'; header: string; code: string } | { type: 'none' };
  } | null;
  mode: AiMode; level: Level;
  exp: string | null;                           // ISO date
  asg: Assignment | null;                       // small assignments on built-in starters
}
export type ClassLinkIntake =
  | { ok: true; link: ClassLinkV1; switchingFrom: string | null }
  | { ok: false; reason: 'expired' | 'unsafe' | 'damaged' };
export interface TeacherData { assignments: Assignment[]; link: ClassLinkV1 | null; notes: Record<string, GalleryNote> }
export interface GalleryNote { fileHash: string; title: string; madeBy: string; checks: Record<Id, boolean>; feedback: string; reviewedAt: number | null }

// ------------------------------------------------------------------ preferences and settings
export interface Prefs {
  theme: 'night' | 'day' | 'contrast';          // 'contrast' is also forced by forced-colors: active
  reduceMotion: 'system' | 'on' | 'off';
  textScale: 1 | 1.15 | 1.3;
  extraSpacing: boolean;                        // WCAG 1.4.12 spacing
  easyRead: boolean;                            // display type in Atkinson too
  uiSounds: 'off' | 'soft' | 'on';              // school builds default 'off'
  gameVolume: number; gameMuted: boolean;       // school builds default muted
  captions: boolean; gameSpeed: 1 | 0.75 | 0.5;
  touchControls: 'auto' | 'on' | 'off';
  readAloud: boolean; singleKeys: boolean;
  leftHanded: boolean; pressure: 'light' | 'normal' | 'firm'; brushSounds: boolean;
  trailView: 'trail' | 'list'; trailPaused: boolean;
  seen: Partial<Record<'firstPage' | 'ghostTip' | 'changeTip' | 'aiExplainer' | 'bonesTip' | 'handinInitials', number>>;
}
export interface ManualAiSettings { baseUrl: string; model: string; fastModel: string; key: string | null; remember: boolean }  // public build only
export interface SettingsMap {
  prefs: Prefs;
  classLink: ClassLinkV1;
  manualAi: ManualAiSettings;
  teacher: TeacherData;
  legacy: { hash: string; at: number; choice: 'brought' | 'dismissed' };
  noVision: string[];                           // AI origins that rejected images
  consent: Record<ArtId, number>;               // Magic bones outline consent, per drawing
  lastRoute: string;                            // restored after a discarded tab
}
export type SettingsKey = keyof SettingsMap;

// ------------------------------------------------------------------ AI (request/response types; §5)
export type AiStatus = 'off' | 'ready' | 'explain-only' | 'offline' | 'blocked' | 'quota' | 'expired' | 'rejected' | 'busy';
export type AiPhase = 'queued' | 'checking' | 'planning' | 'writing' | 'validating' | 'testing' | 'fixing' | 'swapping';
export interface AiProgress { phase: AiPhase; file?: string; lines?: number; chars?: number; round?: 1 | 2; waitMs?: number }
export interface SafetyNote { kind: 'ok' | 'toned-down'; note: string }
export type SafetyVerdict =
  | { kind: 'allow' }
  | { kind: 'pii'; spans: Array<[number, number]>; block: boolean }        // block at elementary
  | { kind: 'refuse'; category: string; message: string; alternatives: string[] }
  | { kind: 'crisis' };
export interface PlanReply {                    // strict JSON schema 'amble_plan' (§5.4)
  status: 'ok' | 'toned_down' | 'refused' | 'crisis';
  safetyNote: string;                           // '' when ok
  title: string;                                // ≤ 28
  pitch: string;                                // ≤ 140, one kid sentence
  starter: StarterId;                           // the closest starter: the build's base and the ladder's fallback
  twist: { name: string; does: string };
  controls: Array<{ keys: string; does: string }>;   // ≤ 5
  cast: PlanCastItem[];                         // 1..8, hero first
  builds: string[];                             // 2..4 bullets: what Amble will build
  dials: Array<{ key: string; label: string }>; // 3..6
}
export interface PlanCastItem {
  key: string; name: string;
  ask: string;                                  // "Draw Rae, a space kid" (≤ 60)
  about: string;                                // "Your hero. Gets bones: walks, jumps, cheers." (≤ 80)
  role: Role; kind: ArtKind; rig: RigKind; facing: Facing; pronoun: Pronoun;
  size: 'tiny' | 'small' | 'hero' | 'big' | 'huge' | 'screen';   // relative to the hero; mapped to w/h by a table (§5.4)
  required: boolean;
  mapsTo: string;                               // the starter's cast key this replaces, or '' (the ladder uses it)
}
export type PlanOutcome =
  | { kind: 'plan'; plan: PlanReply }
  | { kind: 'refused'; note: string; alternatives: string[] }
  | { kind: 'crisis' }
  | { kind: 'fallback'; starter: StarterId; message: string }         // the plan call failed: local idea match
  | { kind: 'cancelled' };
export type AiOutcome =
  | { kind: 'accepted'; files: CodeFile[]; manifest: GameManifest; summary: string; play: string; next: string[];
      safety: SafetyNote; repairs: 0 | 1 | 2; tested: boolean; handEditsTouched: boolean; newArt: CastKey[] }
  | { kind: 'fallback'; files: CodeFile[]; manifest: GameManifest; message: string }   // build only: plan mapped onto the starter (§5.9)
  | { kind: 'refused'; note: string; alternatives: string[] }
  | { kind: 'crisis' }
  | { kind: 'failed'; reason: 'validation' | 'runtime' | 'truncated' | 'mismatch' | 'shape' | 'transport' | 'safety'; message: string; details: string[] }
  | { kind: 'unavailable'; status: AiStatus; message: string }
  | { kind: 'cancelled' };
export interface ExplainReply { answer: string; lines: Array<{ from: number; to: number; note: string }>; safetyNote: string }   // 'amble_explain'
export type ExplainOutcome = { kind: 'explained'; reply: ExplainReply } | Extract<AiOutcome, { kind: 'refused' | 'crisis' | 'failed' | 'unavailable' | 'cancelled' }>;
export type LocalSteer =
  | { kind: 'dial'; key: string; label: string; from: number; to: number }
  | { kind: 'twist'; id: TwistId; name: string; on: boolean };
export interface AiJobView { worldId: WorldId; task: 'plan' | 'build' | 'change' | 'fix'; request: string; progress: AiProgress; startedAt: number }
export interface AiLogEntry {
  id: Id; at: number;
  kind: 'plan' | 'build' | 'change' | 'fix' | 'resend' | 'continue' | 'explain' | 'rig' | 'moderation' | 'test';
  host: string; model: string; bytesSent: number; bytesReceived: number;
  included: string[];                           // "your words", "game.js (131 lines)", "the list of drawings (no pictures)"
  body: string;                                 // the exact JSON body sent (no headers); local only, clearable
  status: 'ok' | 'refused' | 'failed' | 'cancelled';
  replySummary: string;
}

// ------------------------------------------------------------------ files and starters
export interface AmbleManifest {
  format: 'amble-file'; version: 2; kind: 'world' | 'drawing' | 'assignment';
  app: string; title: string; savedAt: string; madeBy: string; assignmentId: Id | null; thumb: 'thumb.png';
}
export interface AmbleFile {
  manifest: AmbleManifest;
  world: World | null; art: ArtRecord[]; steps: StepSnapshot[];
  blobs: Map<BlobRef, Blob>; thumb: Blob | null;
  readOnly: boolean; warnings: string[];
}
export type FileProblemKind = 'not-amble' | 'damaged' | 'too-big' | 'newer' | 'blocked';
export interface StarterInfo {
  id: SeedId; title: string; genre: string;     // "Boss fight"
  blurb: string;                                // "Beat a giant boss in three phases."
  teaches: string;                              // for teachers: "state machines, animation states"
  sign: string;                                 // URL of public/starters/<id>/sign.png
  heroKey: CastKey; yourTurn: CastKey | null; spare: CastKey[];
  tags: string[];                               // words for the ladder's idea match
  hidden: boolean;                              // parade
}
export type SaveState = 'saved' | 'saving' | 'full' | 'files-only' | 'error';
