import { compileNeedsRequest, compileProject, inputHash, NO_ACCOUNT, piecesToWrite } from './compiler/compile';
import { AiError } from './compiler/openai';
import { cancelCodexLogin, fetchCodexStatus, startCodexLogin } from './compiler/chatgpt';
import type { CodexStatus } from './compiler/codexTypes';
import { buildRunPackage, packageKey } from './player/package';
import type { PlayerHost } from './player/host';
import { findTarget, useStore } from './store';
import { uniqueName } from './project/ids';
import { block, workspace } from './project/defaults';
import { applyRename, deleteVariableDeclaration, renameScope, renameVariableDeclaration, type RenameChange } from './blocks/menus';
import type { MenuKind } from './blocks/spec';
import type { CompiledAsset, CompiledGame, CostumeAsset, Project, SoundAsset, SpriteTarget } from './project/types';

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

/**
 * Green flag: runs the blocks as they are now. Changed blocks are built first: exact blocks
 * instantly, and new words with a compile request. While words are already being built (quietly,
 * after typing), the game starts as soon as they are done.
 */
export function startGame(): void {
  if (controller) {
    playWhenBuilt = true;
    useStore.getState().setCompile({ forPlay: true });
    return;
  }
  const s = useStore.getState();
  // Words still waiting for an account build as soon as there may be one.
  if (needsCompile(s.project) || (compileNeedsRequest(s.project) && !s.needsAccount)) {
    void compile(undefined, { fromFlag: true });
    return;
  }
  runGame();
}

/** Runs the compiled game from a fresh start. */
function runGame(): void {
  const { project, clearRunOutput } = useStore.getState();
  clearRunOutput();
  lastPreviewKey = packageKey(project);
  player?.load(buildRunPackage(project), true);
  player?.focus();
}

/** Stop: stops the game, and a build the flag asked for (a quiet build carries on, without starting the game). */
export function stopGame(): void {
  playWhenBuilt = false;
  if (controller && !quietBuild) controller.abort();
  else useStore.getState().setCompile({ forPlay: false });
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
/** The build running now started by itself after typing (it updates the stage but doesn't start the game). */
let quietBuild = false;
/** The flag was pressed during a quiet build: start the game when it is done. */
let playWhenBuilt = false;
let accountTimer: number | null = null;

useStore.subscribe((s, prev) => {
  // Opening another project stops a build of the one before.
  if (s.projectLoads !== prev.projectLoads) controller?.abort();
  // A new key or sign-in: words that were waiting for one build quietly.
  if (prev.needsAccount && !s.needsAccount) {
    if (accountTimer !== null) window.clearTimeout(accountTimer);
    accountTimer = window.setTimeout(() => {
      accountTimer = null;
      buildQuietly();
    }, 1500);
  }
});

export function needsCompile(project: Project): boolean {
  return !project.compiled || project.compiled.inputHash !== inputHash(project);
}

/**
 * Compiles the blocks into the game and starts it. Exact blocks compile instantly; words that
 * are new (or, with `fixProblems`, the words of sprites that had problems) are sent in a compile
 * request, which may also rewrite other words to fit. `fresh` starts over: every word is written
 * again and the compiled art is made again, so it can come out different.
 */
export async function compile(fixProblems?: string[], opts: { fromFlag?: boolean; fresh?: boolean; quiet?: boolean; play?: boolean } = {}): Promise<void> {
  if (controller) return;
  const store = useStore.getState();
  const project = store.project;
  controller = new AbortController();
  const loads = store.projectLoads;
  quietBuild = Boolean(opts.quiet);
  playWhenBuilt = !opts.quiet && opts.play !== false;
  // Instant compiles don't show progress: the game just starts.
  const instant = !fixProblems?.length && !opts.fresh && !compileNeedsRequest(project);
  const building = instant ? [] : piecesToWrite(project, Boolean(opts.fresh || fixProblems?.length));
  store.setCompile({
    status: instant ? 'idle' : 'running',
    progress: instant ? null : { stage: 'preparing', message: 'Reading your blocks' },
    error: null,
    building,
    forPlay: playWhenBuilt,
    failed: [],
  });
  const done = (compiled: CompiledGame) => {
    // Another project was opened meanwhile: this build was for the one before.
    if (useStore.getState().projectLoads !== loads) return;
    useStore.getState().update((p) => {
      p.compiled = compiled;
    });
    useStore.getState().setCompile({ status: 'done', progress: null, building: [], forPlay: false });
    const revised = compiled.revised ?? [];
    if (revised.length) {
      const n = revised.length;
      useStore.getState().notify(`To fit your change, ${n} other block${n > 1 ? 's now work' : ' now works'} a little differently: ${revised.slice(0, 3).join('; ')}${n > 3 ? '…' : ''}`);
    }
    // A quiet build only shows the new version on the stage, unless the flag was pressed meanwhile.
    if (playWhenBuilt) runGame();
    else if (useStore.getState().run.state !== 'running') previewProject(useStore.getState().project, true);
    playWhenBuilt = false;
  };
  try {
    done(
      await compileProject(project, {
        settings: store.settings,
        signal: controller.signal,
        fixProblems,
        fresh: opts.fresh,
        onProgress: instant ? undefined : (progress) => useStore.getState().setCompile({ progress }),
      }),
    );
  } catch (err) {
    const s = useStore.getState();
    if (controller?.signal.aborted) {
      s.setCompile({ status: 'idle', progress: null, building: [], forPlay: false });
    } else if (err instanceof AiError && err.code === NO_ACCOUNT) {
      // Words wait for an account (their blocks say so); the flag still plays everything else.
      s.setNeedsAccount(true);
      if (opts.quiet && !playWhenBuilt) s.setCompile({ status: 'idle', progress: null, building: [], forPlay: false });
      else done(await compileProject(project, { settings: s.settings, offline: true }));
    } else if (opts.quiet && !playWhenBuilt) {
      // Building after typing never interrupts: problems show when the flag builds again.
      console.warn('Building in the background stopped:', err);
      s.setCompile({ status: 'idle', progress: null, building: [], forPlay: false });
    } else {
      // The failure shows on the blocks that were building, and next to the flag; nothing pops open.
      const message = err instanceof Error ? err.message : String(err);
      s.setCompile({ status: 'error', progress: null, error: message, building: [], forPlay: false, failed: building });
    }
  } finally {
    controller = null;
    quietBuild = false;
  }
}

/** Builds what changed without starting the game (e.g. to export it), and returns the project as built. */
export async function buildNow(): Promise<Project> {
  while (controller) await new Promise((r) => window.setTimeout(r, 100));
  const s = useStore.getState();
  if (needsCompile(s.project) || (compileNeedsRequest(s.project) && !s.needsAccount)) await compile(undefined, { play: false });
  return useStore.getState().project;
}

export function cancelCompile(): void {
  controller?.abort();
}

/**
 * Builds new words quietly once the student has finished typing them, so the flag usually has nothing
 * left to wait for. Nothing happens without new words, during another build, or without an account.
 */
export function buildQuietly(): void {
  const s = useStore.getState();
  if (controller || s.needsAccount || !compileNeedsRequest(s.project)) return;
  void compile(undefined, { quiet: true });
}

/** "Fix": compiles the words again, with the problems from the last run. */
export function fixProblems(): void {
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
  notify('Signed in. Blocks in your own words build now.');
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
      // What it did becomes a block of its own: an "always:" in its own words, built like any other.
      blocks: workspace(block('ru_always', { RULE: s.description.trim() || `be ${s.name}` })),
      x: s.x,
      y: s.y,
      z: 0,
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
  notify('Kept. What it does is now a block in its code.');
  window.setTimeout(buildQuietly, 300);
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
