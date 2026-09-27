import { compileProject, inputHash } from './compiler/compile';
import { AiError, CHATGPT_MODEL_NAME } from './compiler/openai';
import { cancelCodexLogin, fetchCodexStatus, startCodexLogin } from './compiler/chatgpt';
import type { CodexStatus } from './compiler/codexTypes';
import { buildRunPackage, packageKey } from './player/package';
import type { PlayerHost } from './player/host';
import { findTarget, useStore } from './store';
import { uniqueName } from './project/ids';
import { applyRename, deleteVariableDeclaration, renameScope, renameVariableDeclaration, type RenameChange } from './blocks/menus';
import type { MenuKind } from './blocks/spec';
import type { CompiledAsset, CostumeAsset, Project, SoundAsset, SpriteTarget } from './project/types';

// -----------------------------------------------------------------------------
// The stage player
// -----------------------------------------------------------------------------

let player: PlayerHost | null = null;

export function registerPlayer(host: PlayerHost | null): void {
  player = host;
  lastPreviewKey = '';
}

export function getPlayer(): PlayerHost | null {
  return player;
}

/** Green flag: run the latest compiled game from a fresh start. */
export function startGame(): void {
  const { project, clearRunOutput, setOutputTab } = useStore.getState();
  clearRunOutput();
  setOutputTab(project.compiled ? 'game' : 'problems');
  lastPreviewKey = packageKey(project);
  player?.load(buildRunPackage(project), true);
  player?.focus();
}

export function stopGame(): void {
  player?.stop();
}

let lastPreviewKey = '';

/** Shows the current project on the stage without running it (skipped when nothing visible changed). */
export function previewProject(project: Project, force = false): void {
  const key = packageKey(project);
  if (!force && key === lastPreviewKey) return;
  lastPreviewKey = key;
  player?.load(buildRunPackage(project), false);
}

/** A sprite was dragged on the stage: it starts there from now on (the stage already shows it there). */
export function moveSpriteFromStage(name: string, x: number, y: number): void {
  const store = useStore.getState();
  const own = store.project.sprites.find((s) => s.name === name);
  const compiled = own ? null : store.project.compiled?.sprites.find((s) => s.name === name);
  if (!own && !compiled) return;
  store.update((p) => {
    const s = own ? p.sprites.find((t) => t.id === own.id) : p.compiled?.sprites.find((t) => t.id === compiled!.id);
    if (!s) return;
    s.x = x;
    s.y = y;
  });
  lastPreviewKey = packageKey(useStore.getState().project);
  // Like Scratch, the sprite you drag becomes the one you edit.
  store.select((own ?? compiled)!.id);
}

// -----------------------------------------------------------------------------
// Compiling
// -----------------------------------------------------------------------------

let controller: AbortController | null = null;

export function needsCompile(project: Project): boolean {
  return !project.compiled || project.compiled.mode !== project.mode || project.compiled.inputHash !== inputHash(project);
}

/** Sends the blocks to the AI, stores the compiled game, and starts it. */
export async function compile(fixProblems?: string[]): Promise<void> {
  if (controller) return;
  const store = useStore.getState();
  controller = new AbortController();
  store.setCompile({ status: 'running', progress: { stage: 'preparing', message: 'Reading your blocks' }, error: null });
  try {
    const compiled = await compileProject(store.project, {
      settings: store.settings,
      signal: controller.signal,
      fixProblems,
      onProgress: (progress) => useStore.getState().setCompile({ progress }),
    });
    useStore.getState().update((p) => {
      p.compiled = compiled;
    });
    useStore.getState().setCompile({ status: 'done', progress: null });
    useStore.getState().setOutputTab('game');
    startGame();
  } catch (err) {
    const s = useStore.getState();
    if (controller?.signal.aborted) {
      s.setCompile({ status: 'idle', progress: null });
    } else {
      const message = err instanceof AiError || err instanceof Error ? err.message : String(err);
      s.setCompile({ status: 'error', progress: null, error: message });
      if (/api key|Settings|sign in/i.test(message)) s.setDialog('settings');
    }
  } finally {
    controller = null;
  }
}

export function cancelCompile(): void {
  controller?.abort();
}

/** "Fix with AI": recompile with the problems from the last run. */
export function fixWithAi(): void {
  const { run, project } = useStore.getState();
  const problems = run.errors.map(
    (e) => `${e.target ? `${e.target}` : 'Game'}${e.script ? ` (${e.script})` : ''}: ${e.message}${e.line ? ` [line ${e.line}]` : ''}`,
  );
  for (const log of run.logs) if (log.level !== 'log') problems.push(log.message);
  if (!problems.length && project.compiled?.warnings.length) problems.push(...project.compiled.warnings.slice(0, 10));
  void compile(problems.length ? problems.slice(0, 30) : ['The game does not behave the way the blocks describe. Review it carefully.']);
}

// -----------------------------------------------------------------------------
// Sign in with ChatGPT (through Codex, when Amble runs on your computer)
// -----------------------------------------------------------------------------

/** Re-reads whether Codex is installed here and how it's signed in (null on static hosting). */
export async function refreshChatGpt(): Promise<CodexStatus | null> {
  const status = await fetchCodexStatus();
  useStore.getState().setCodex(status);
  return status;
}

let loginPoll: number | null = null;

function stopLoginPoll(): void {
  if (loginPoll !== null) window.clearInterval(loginPoll);
  loginPoll = null;
}

function signedIn(): void {
  const { setSettings, notify } = useStore.getState();
  setSettings({ useChatGpt: true });
  notify(`Signed in with ChatGPT. Compiling now uses ${CHATGPT_MODEL_NAME} on your ChatGPT plan.`);
}

/**
 * Uses Codex's ChatGPT sign-in if it already has one; otherwise runs `codex login`, which opens
 * the ChatGPT sign-in page, and waits for it to finish.
 */
export async function signInWithChatGpt(): Promise<void> {
  const { notify, setDialog, setCodex } = useStore.getState();
  try {
    const status = await refreshChatGpt();
    if (!status) {
      notify('Signing in with ChatGPT works when Amble runs on your computer (npm run dev).', 'error');
      return;
    }
    if (!status.installed) {
      setDialog('settings');
      return;
    }
    if (status.auth === 'chatgpt') {
      signedIn();
      return;
    }
    const started = await startCodexLogin();
    setCodex(started);
    if (started.login.error) {
      notify(started.login.error, 'error');
      return;
    }
    setDialog('settings');
    stopLoginPoll();
    loginPoll = window.setInterval(() => {
      void refreshChatGpt().then((s) => {
        if (!s) return stopLoginPoll();
        if (s.auth === 'chatgpt') {
          stopLoginPoll();
          signedIn();
        } else if (!s.login.pending) {
          stopLoginPoll();
          if (s.login.error) notify(`Signing in didn't finish: ${s.login.error}`, 'error');
        }
      });
    }, 1500);
  } catch (err) {
    notify(`Couldn't start signing in: ${(err as Error).message}`, 'error');
  }
}

export async function cancelChatGptSignIn(): Promise<void> {
  stopLoginPoll();
  try {
    useStore.getState().setCodex(await cancelCodexLogin());
  } catch {
    await refreshChatGpt();
  }
}

/** Stops using the ChatGPT sign-in. Codex itself stays signed in on this computer. */
export function signOutOfChatGpt(): void {
  const { setSettings, notify } = useStore.getState();
  setSettings({ useChatGpt: false });
  notify('Signed out. Amble will use an API key if you add one.');
}

// -----------------------------------------------------------------------------
// Compiled assets
// -----------------------------------------------------------------------------

function stripCompiled(asset: CompiledAsset): CostumeAsset | SoundAsset {
  const { targetId: _t, targetName: _n, request, ...rest } = asset;
  void _t;
  void _n;
  return { ...rest, description: rest.description ?? request } as CostumeAsset | SoundAsset;
}

/** Moves a compiled asset into the author's own assets. */
export function keepCompiledAsset(assetId: string): void {
  const { update, notify } = useStore.getState();
  update((p) => {
    const compiled = p.compiled;
    if (!compiled) return;
    const asset = compiled.assets.find((a) => a.id === assetId);
    if (!asset) return;
    const target = p.stage.id === asset.targetId ? p.stage : p.sprites.find((s) => s.id === asset.targetId);
    if (!target) return;
    const own = stripCompiled(asset);
    if (own.kind === 'sound') {
      own.name = uniqueName(own.name, target.sounds.map((s) => s.name));
      target.sounds.push(own);
    } else {
      own.name = uniqueName(own.name, target.costumes.map((c) => c.name));
      target.costumes.push(own);
    }
    compiled.assets = compiled.assets.filter((a) => a.id !== assetId);
  });
  notify('Kept. It is now one of your assets.');
}

export function deleteCompiledAsset(assetId: string): void {
  useStore.getState().update((p) => {
    if (p.compiled) p.compiled.assets = p.compiled.assets.filter((a) => a.id !== assetId);
  });
}

/** Turns a compiled sprite into one of the author's sprites (keeping its compiled behavior until the next build). */
export function keepCompiledSprite(spriteId: string): void {
  const { update, select, notify } = useStore.getState();
  update((p) => {
    const compiled = p.compiled;
    const s = compiled?.sprites.find((x) => x.id === spriteId);
    if (!compiled || !s) return;
    const assets = compiled.assets.filter((a) => a.targetId === spriteId);
    const sprite: SpriteTarget = {
      id: s.id,
      kind: 'sprite',
      name: uniqueName(s.name, p.sprites.map((x) => x.name)),
      description: s.description,
      costumes: assets.filter((a) => a.kind !== 'sound').map((a) => stripCompiled(a) as CostumeAsset),
      sounds: assets.filter((a) => a.kind === 'sound').map((a) => stripCompiled(a) as SoundAsset),
      currentCostume: 0,
      blocks: null,
      x: s.x,
      y: s.y,
      z: s.z,
      size: s.size,
      direction: s.direction,
      visible: s.visible,
      rotationStyle: s.rotationStyle,
    };
    p.sprites.push(sprite);
    compiled.sprites = compiled.sprites.filter((x) => x.id !== spriteId);
    compiled.assets = compiled.assets.filter((a) => a.targetId !== spriteId);
  });
  select(spriteId);
  notify('Kept. Its behavior now comes from its description until you add blocks.');
}

// -----------------------------------------------------------------------------
// Renaming (blocks follow, like in Scratch)
// -----------------------------------------------------------------------------

/** The block editor, so that renames also reach the blocks on screen. */
export interface LiveBlocks {
  /** Saves the editor's blocks into the project now. */
  flush(): void;
  /** The sprite or stage shown in the editor. */
  targetId(): string | null;
  /** Renames dropdown values in the editor's blocks. */
  renameMenus(kinds: MenuKind[], from: string, to: string): void;
}

let live: LiveBlocks | null = null;

export function registerLiveBlocks(next: LiveBlocks | null): void {
  live = next;
}

/** Applies a rename to the project (with `rename` changing the name itself) and to the blocks on screen. */
function renameWithBlocks(rename: (p: Project) => RenameChange | null): void {
  live?.flush();
  let change: RenameChange | null = null;
  useStore.getState().update((p) => {
    change = rename(p);
    if (change) applyRename(p, change);
  });
  const done = change as RenameChange | null;
  const shown = live?.targetId();
  if (!done || !shown) return;
  const { kinds, targetIds } = renameScope(useStore.getState().project, done);
  if (!targetIds.includes(shown)) return;
  live?.renameMenus(kinds.filter((k) => k !== 'costume' || shown === done.targetId), done.from, done.to);
}

/** Renames a costume (or backdrop); blocks that switch to it follow. */
export function renameCostume(targetId: string, assetId: string, name: string): void {
  const wanted = name.trim();
  if (!wanted) return;
  renameWithBlocks((p) => {
    const t = findTarget(p, targetId);
    const c = t?.costumes.find((x) => x.id === assetId);
    if (!t || !c) return null;
    const next = uniqueName(wanted, t.costumes.filter((x) => x.id !== assetId).map((x) => x.name));
    if (next === c.name) return null;
    const change: RenameChange = { kind: 'costume', targetId, from: c.name, to: next };
    c.name = next;
    return change;
  });
}

/** Renames a sound; blocks that play it follow. */
export function renameSound(targetId: string, assetId: string, name: string): void {
  const wanted = name.trim();
  if (!wanted) return;
  renameWithBlocks((p) => {
    const t = findTarget(p, targetId);
    const snd = t?.sounds.find((x) => x.id === assetId);
    if (!t || !snd) return null;
    const next = uniqueName(wanted, t.sounds.filter((x) => x.id !== assetId).map((x) => x.name));
    if (next === snd.name) return null;
    const change: RenameChange = { kind: 'sound', targetId, from: snd.name, to: next };
    snd.name = next;
    return change;
  });
}

/** Renames a sprite; "create clone of" blocks that name it follow. */
export function renameSprite(spriteId: string, name: string): void {
  const wanted = name.trim();
  if (!wanted) return;
  renameWithBlocks((p) => {
    const sprite = p.sprites.find((x) => x.id === spriteId);
    if (!sprite) return null;
    const next = uniqueName(wanted, p.sprites.filter((x) => x.id !== spriteId).map((x) => x.name));
    if (next === sprite.name) return null;
    const change: RenameChange = { kind: 'sprite', targetId: spriteId, from: sprite.name, to: next };
    sprite.name = next;
    return change;
  });
}

/** Renames a variable (for all sprites, or the edited sprite's own); every block using it follows. */
export function renameVariable(editedTargetId: string | null, from: string, to: string): void {
  if (!to || to === from) return;
  renameWithBlocks((p) => renameVariableDeclaration(p, editedTargetId, from, to));
}

/** Removes a variable's declaration. */
export function deleteVariable(editedTargetId: string | null, name: string): void {
  useStore.getState().update((p) => deleteVariableDeclaration(p, editedTargetId, name));
}
