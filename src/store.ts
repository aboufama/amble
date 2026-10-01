import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { CompileProgress } from './compiler/compile';
import type { AiSettings } from './compiler/openai';
import type { CodexStatus } from './compiler/codexTypes';
import type { PlayerError } from './player/protocol';
import type { CompiledAsset, CompiledSprite, CostumeAsset, Project, SoundAsset, SpriteTarget, Target } from './project/types';
import { loadSettings, saveSettings } from './project/persistence';
import { newProject } from './project/defaults';
import { migrateProject } from './project/migrate';

export type Tab = 'code' | 'costumes' | 'sounds';
/** Scratch's stage size buttons: the normal stage, or a small one that leaves more room for code. */
export type StageSize = 'small' | 'large';
export type RunState = 'loading' | 'idle' | 'running' | 'paused' | 'stopped';
export type OutputTab = 'game' | 'problems' | 'console' | 'code';

/** A question shown in a Scratch-style dialog (New Variable, New Message...). */
export interface PromptRequest {
  title: string;
  /** The question: the text field's label, or the message of a confirmation. */
  label: string;
  /** 'prompt' (default) asks for a name; 'confirm' asks yes or no; 'alert' only informs. */
  kind?: 'prompt' | 'confirm' | 'alert';
  defaultValue?: string;
  /** Offer "For all sprites" / "For this sprite only". */
  scope?: boolean;
  /** The main button's text ("OK" by default). */
  confirmLabel?: string;
  /** A destructive action: the main button is red. */
  danger?: boolean;
}

export interface LogEntry {
  id: number;
  level: 'log' | 'warn' | 'error';
  message: string;
}

export interface EditorState {
  project: Project;
  /** Counts whole-project replacements (loading a file, New, examples), so editors reload. */
  projectLoads: number;
  selectedId: string;
  tab: Tab;
  stageSize: StageSize;
  costumeSel: Record<string, string>;
  soundSel: Record<string, string>;
  settings: AiSettings;
  /** ChatGPT sign-in through Codex on this computer; null when unavailable (e.g. GitHub Pages). */
  codex: CodexStatus | null;
  compile: {
    status: 'idle' | 'running' | 'error' | 'done';
    progress: CompileProgress | null;
    error: string | null;
    /** The words being built (shown assembling on their blocks), while a build runs. */
    building: Array<{ targetId: string; words: string }>;
    /** The green flag asked for this build (or for the game once it is built): the flag shows it building. */
    forPlay: boolean;
    /** The words a build that failed was building (the failure shows on their blocks). */
    failed: Array<{ targetId: string; words: string }>;
  };
  /** Words can't build without a sign-in or a key: found on the last try, until the settings or the sign-in change. */
  needsAccount: boolean;
  run: { state: RunState; errors: PlayerError[]; logs: LogEntry[] };
  dialog: null | 'settings' | 'new' | 'about';
  prompt: PromptRequest | null;
  /** The tab shown in the problems dialog ('game' is an old name for 'problems'). */
  outputTab: OutputTab;
  /** The problems dialog (problems, console, compiled code) is open. */
  problemsOpen: boolean;
  /** The Sounds tab's Record Sound dialog is open. */
  recording: boolean;
  /** Edit > Restore: puts back the last deleted sprite, costume, backdrop or sound. */
  restore: { what: 'Sprite' | 'Costume' | 'Backdrop' | 'Sound'; run(): void } | null;
  toast: { id: number; message: string; tone: 'info' | 'error' } | null;

  setProject(project: Project): void;
  update(fn: (draft: Project) => void): void;
  select(id: string): void;
  setTab(tab: Tab): void;
  setStageSize(size: StageSize): void;
  selectCostume(targetId: string, assetId: string): void;
  selectSound(targetId: string, assetId: string): void;
  setSettings(patch: Partial<AiSettings>): void;
  setCodex(status: CodexStatus | null): void;
  setCompile(patch: Partial<EditorState['compile']>): void;
  setNeedsAccount(needs: boolean): void;
  setRunState(state: RunState): void;
  addError(error: PlayerError): void;
  addLog(level: LogEntry['level'], message: string): void;
  clearRunOutput(): void;
  setDialog(dialog: EditorState['dialog']): void;
  setPrompt(prompt: PromptRequest | null): void;
  setOutputTab(tab: OutputTab): void;
  setProblemsOpen(open: boolean): void;
  setRestore(restore: EditorState['restore']): void;
  setRecording(open: boolean): void;
  notify(message: string, tone?: 'info' | 'error'): void;
}

let logId = 0;
const initial = newProject();

export const useStore = create<EditorState>()(
  immer((set) => ({
    project: initial,
    projectLoads: 0,
    selectedId: initial.sprites[0]?.id ?? initial.stage.id,
    tab: 'code',
    stageSize: 'large',
    costumeSel: {},
    soundSel: {},
    settings: loadSettings(),
    codex: null,
    compile: { status: 'idle', progress: null, error: null, building: [], forPlay: false, failed: [] },
    needsAccount: false,
    run: { state: 'loading', errors: [], logs: [] },
    dialog: null,
    prompt: null,
    outputTab: 'game',
    problemsOpen: false,
    restore: null,
    recording: false,
    toast: null,

    setProject: (project) =>
      set((s) => {
        // Projects from older versions of Amble get the current blocks.
        s.project = migrateProject(project);
        s.projectLoads += 1;
        s.selectedId = project.sprites[0]?.id ?? project.stage.id;
        s.costumeSel = {};
        s.soundSel = {};
        s.compile = { status: 'idle', progress: null, error: null, building: [], forPlay: false, failed: [] };
        s.run.errors = [];
        s.run.logs = [];
        s.restore = null;
      }),
    update: (fn) =>
      set((s) => {
        fn(s.project as Project);
      }),
    select: (id) =>
      set((s) => {
        s.selectedId = id;
      }),
    setTab: (tab) =>
      set((s) => {
        s.tab = tab;
      }),
    setStageSize: (size) =>
      set((s) => {
        s.stageSize = size;
      }),
    selectCostume: (targetId, assetId) =>
      set((s) => {
        s.costumeSel[targetId] = assetId;
      }),
    selectSound: (targetId, assetId) =>
      set((s) => {
        s.soundSel[targetId] = assetId;
      }),
    setSettings: (patch) =>
      set((s) => {
        Object.assign(s.settings, patch);
        saveSettings({ ...s.settings });
        s.needsAccount = false;
      }),
    setCodex: (status) =>
      set((s) => {
        if (JSON.stringify(s.codex) !== JSON.stringify(status)) s.needsAccount = false;
        s.codex = status;
      }),
    setCompile: (patch) =>
      set((s) => {
        Object.assign(s.compile, patch);
      }),
    setNeedsAccount: (needs) =>
      set((s) => {
        s.needsAccount = needs;
      }),
    setRunState: (state) =>
      set((s) => {
        s.run.state = state;
      }),
    addError: (error) =>
      set((s) => {
        if (s.run.errors.length < 50) s.run.errors.push(error);
      }),
    addLog: (level, message) =>
      set((s) => {
        s.run.logs.push({ id: ++logId, level, message });
        if (s.run.logs.length > 300) s.run.logs.splice(0, s.run.logs.length - 300);
      }),
    clearRunOutput: () =>
      set((s) => {
        s.run.errors = [];
        s.run.logs = [];
      }),
    setDialog: (dialog) =>
      set((s) => {
        s.dialog = dialog;
      }),
    setPrompt: (prompt) =>
      set((s) => {
        s.prompt = prompt;
      }),
    setOutputTab: (tab) =>
      set((s) => {
        s.outputTab = tab;
      }),
    setProblemsOpen: (open) =>
      set((s) => {
        s.problemsOpen = open;
      }),
    setRestore: (restore) =>
      set((s) => {
        s.restore = restore;
      }),
    setRecording: (open) =>
      set((s) => {
        s.recording = open;
      }),
    notify: (message, tone = 'info') =>
      set((s) => {
        s.toast = { id: ++logId, message, tone };
      }),
  })),
);

// -----------------------------------------------------------------------------
// Selectors
// -----------------------------------------------------------------------------

/** A compiled sprite shown in the sprite list (read-only). */
export interface CompiledView {
  kind: 'compiled';
  sprite: CompiledSprite;
  costumes: CompiledAsset[];
  sounds: CompiledAsset[];
}

export function findTarget(project: Project, id: string): Target | null {
  if (project.stage.id === id) return project.stage;
  return project.sprites.find((s) => s.id === id) ?? null;
}

export function findCompiledSprite(project: Project, id: string): CompiledView | null {
  const sprite = project.compiled?.sprites.find((s) => s.id === id);
  if (!sprite) return null;
  const assets = project.compiled!.assets.filter((a) => a.targetId === id);
  return { kind: 'compiled', sprite, costumes: assets.filter((a) => a.kind !== 'sound'), sounds: assets.filter((a) => a.kind === 'sound') };
}

export function compiledAssetsFor(project: Project, targetId: string): CompiledAsset[] {
  return project.compiled?.assets.filter((a) => a.targetId === targetId) ?? [];
}

export function isSprite(t: Target | null): t is SpriteTarget {
  return Boolean(t && t.kind === 'sprite');
}

export function allCostumeNames(t: Target): string[] {
  return t.costumes.map((c: CostumeAsset) => c.name);
}

export function allSoundNames(t: Target): string[] {
  return t.sounds.map((s: SoundAsset) => s.name);
}

// The end-to-end tests reach the store on the dev server (e.g. to add a key without the Settings dialog).
if (import.meta.env.DEV) (window as unknown as { __ambleStore?: typeof useStore }).__ambleStore = useStore;
