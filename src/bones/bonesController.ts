/**
 * The Bones view's controller (§2.11, §7.11): opens a drawing and its bones, runs every edit through
 * the rig core's pure editing API onto an undo stack, re-binds in the rig worker 150 ms after an edit
 * lands (the preview and Show pieces use the bind), saves continuously (so leaving never prompts), and
 * on Done records the footstep and hot-swaps the new bones into the running world.
 *
 * Framework-free: React reads it with `useSyncExternalStore(subscribe, getView)`.
 */
import type { Services } from '../app/services';
import { t } from '../i18n';
import {
  RigWorkerError,
  hashRig,
  rigWorker,
  setFacing,
  setRigid,
  setTweak,
  visionSilhouette,
  type AnimTweak,
  type BoundRig,
  type CharacterKind,
  type FitIssue,
  type JointHints,
  type Point,
  type RigData,
  type RigReply,
  type Side,
} from '../cores/rig';
import { addDynamic } from '../cores/rig';
import type { ArtId, ArtRecord, CastKey, Facing, World, WorldId } from '../model/types';
import { showToast } from '../state/app';
import { getState, setState } from '../state/store';
import { confirmUser } from '../ui/dialogs';
import { aiHintsAllowed, createConsentMemory, type ConsentMemory } from './consent';
import { keyboardWiggly, mirrorBones, newestTip, removeWithCount } from './edits';
import { scaleHints } from './geometry';
import { canRedo, canUndo, commit, createStack, redo, settle, undo, type UndoStack } from './rigHistory';
import { decodePixels, drawnArtOf, encodePng, loadDrawingSource, type DrawingSource } from './source';
import { facingWord, rigFacing } from './kindWords';
import { issuesFromNotes } from './words';

export type BonesTarget = { worldId: WorldId; key: CastKey } | { artId: ArtId };

export type RigMade = NonNullable<ArtRecord['rigInfo']>['made'];

/** One step of the undo stack: the bones and what the app knows about how they were made. */
export interface BonesStep {
  rig: RigData;
  made: RigMade;
  /** 0..1; below 0.6 the view shows Amble's guess. */
  confidence: number;
  issues: FitIssue[];
  notes: string[];
}

export interface BonesView {
  /** loading: reading the drawing; missing: no such drawing; undrawn: a cast member still just bones. */
  phase: 'loading' | 'missing' | 'undrawn' | 'ready';
  name: string;
  worldId: WorldId | null;
  castKey: CastKey | null;
  artId: ArtId | null;
  /** The flat drawing (object URL) and its size in art px. */
  image: { url: string; w: number; h: number } | null;
  /** The newest step (null while there are no bones yet). */
  step: BonesStep | null;
  /** The bones on screen: a drag in progress, else the newest step's. */
  rig: RigData | null;
  /** The latest bind of the shown bones (the preview, Show pieces). */
  bound: BoundRig | null;
  /** finding: the first bones; refit: Magic bones or a new kind; asking: waiting for the AI helper. */
  busy: 'finding' | 'refit' | 'asking' | null;
  /** No bones yet: the kind picker opens. `failed` when Amble tried and couldn't. */
  needsKind: boolean;
  failed: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** The AI helper's hints were used in this visit. */
  aiHelped: boolean;
  saveError: boolean;
}

const INITIAL: BonesView = {
  phase: 'loading', name: '', worldId: null, castKey: null, artId: null, image: null, step: null, rig: null, bound: null,
  busy: null, needsKind: false, failed: false, canUndo: false, canRedo: false, aiHelped: false, saveError: false,
};

/** Re-bind this long after an edit lands (§7.11). */
export const BIND_DELAY_MS = 150;
/** Save this long after the last edit (bones save continuously). */
export const SAVE_DELAY_MS = 600;

const isSuperseded = (e: unknown) => e instanceof RigWorkerError && e.superseded;

/** "moonKing" → "Moon king": a name for a member the game has not named for us. */
function nameFromKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

function castName(world: World, key: CastKey): string {
  const member = getState().session.cast.find((m) => m.key === key);
  return member?.name ?? world.cast[key]?.extra?.name ?? nameFromKey(key);
}

function stepOf(r: Pick<RigReply, 'rig' | 'confidence' | 'issues' | 'notes'>, made: RigMade): BonesStep {
  return { rig: r.rig, made, confidence: r.confidence, issues: [...r.issues], notes: [...r.notes] };
}

/** Keeps the open world's session in step with a world this screen committed (M2's autosave writes it). */
function syncSession(world: World): void {
  if (getState().session.world?.id !== world.id) return;
  setState((s) => {
    if (s.session.world?.id === world.id) s.session.world = world;
  });
}

export class BonesController {
  private view: BonesView = INITIAL;
  private readonly listeners = new Set<() => void>();
  private stack: UndoStack<BonesStep> | null = null;
  private live: RigData | null = null;
  private source: DrawingSource | null = null;
  private record: ArtRecord | null = null;
  /** The bones as they were when the student arrived (a footstep only when they differ). */
  private openedRig: string | null = null;
  private savedStep: BonesStep | null = null;
  private saving: Promise<void> = Promise.resolve();
  private bindTimer: ReturnType<typeof setTimeout> | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private lastSide: Side | null = null;
  private disposed = false;
  private finished = false;
  private readonly abort = new AbortController();
  private readonly consent: ConsentMemory;

  constructor(private readonly target: BonesTarget, private readonly services: Services) {
    this.consent = createConsentMemory(services.store.settings);
    this.view = 'artId' in target ? { ...INITIAL, artId: target.artId } : { ...INITIAL, worldId: target.worldId, castKey: target.key };
  }

  // ---------------------------------------------------------------- reading it

  readonly getView = (): BonesView => this.view;

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<BonesView>): void {
    if (this.disposed) return;
    this.view = { ...this.view, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Re-derives what comes from the stack and the drag in progress. */
  private refresh(patch: Partial<BonesView> = {}): void {
    const s = this.stack;
    this.set({
      step: s?.present ?? null,
      rig: this.live ?? s?.present.rig ?? null,
      canUndo: !!s && canUndo(s),
      canRedo: !!s && canRedo(s),
      ...patch,
    });
  }

  /** The drawing's current record (with the newest saved bones). */
  get art(): ArtRecord | null {
    return this.record;
  }

  // ---------------------------------------------------------------- opening

  async open(): Promise<void> {
    const { store } = this.services;
    try {
      let record: ArtRecord | null = null;
      if ('artId' in this.target) {
        record = await store.art.get(this.target.artId);
      } else {
        const world = await store.worlds.get(this.target.worldId);
        if (!world) return this.set({ phase: 'missing' });
        const slot = world.cast[this.target.key];
        record = slot?.art ? await store.art.get(slot.art) : null;
        if (!record) return this.set({ phase: 'undrawn', name: castName(world, this.target.key) });
      }
      if (this.disposed) return;
      if (!record) return this.set({ phase: 'missing' });
      if (!record.export) return this.set({ phase: 'undrawn', name: record.name, artId: record.id });
      const source = await loadDrawingSource(store, record);
      const url = source ? await store.blobs.url(record.export.flat) : null;
      if (this.disposed) return;
      if (!source || !url) return this.set({ phase: 'missing', name: record.name });
      this.record = record;
      this.source = source;
      this.set({ phase: 'ready', name: record.name, artId: record.id, image: { url, w: source.w, h: source.h } });
      if (record.rigData) {
        const info = record.rigInfo;
        const notes = info?.notes ?? [];
        this.stack = createStack<BonesStep>({
          rig: record.rigData,
          made: info?.made ?? record.rigData.made,
          confidence: info?.confidence ?? 1,
          issues: issuesFromNotes(notes),
          notes,
        });
        this.openedRig = JSON.stringify(record.rigData);
        this.savedStep = this.stack.present;
        this.refresh();
        this.scheduleBind(0);
      } else if (record.rig !== 'none') {
        await this.findBones(record.rig, record.facing);
      } else {
        this.refresh({ needsKind: true });
      }
    } catch (err) {
      console.warn('Bones could not open this drawing:', err);
      this.set({ phase: 'missing' });
    }
  }

  /** The first bones for a drawing that has none (or a kind picked after a failure). */
  private async findBones(kind: CharacterKind, facing: Facing): Promise<void> {
    const src = this.source;
    if (!src) return;
    this.set({ busy: 'finding', needsKind: false, failed: false });
    try {
      const r = await rigWorker.autoRig(src.rig, { kind, facing: rigFacing(facing), lane: 'bones-fit' });
      if (this.disposed) return;
      this.stack = createStack(stepOf(r, r.rig.made === 'hand' ? 'hand' : 'auto'));
      // bones Amble found on arrival are not the student's change (no footstep for them)
      this.openedRig ??= JSON.stringify(r.rig);
      this.refresh({ busy: null });
      this.scheduleBind(0);
      void this.saveNow();
    } catch (err) {
      if (isSuperseded(err)) return;
      console.warn('Bones could not find bones:', err);
      this.set({ busy: null, needsKind: true, failed: true });
    }
  }

  // ---------------------------------------------------------------- edits

  /** A drag in progress: shows these bones without adding a step. */
  preview(rig: RigData): void {
    if (!this.stack || this.view.busy) return;
    this.live = rig;
    this.refresh();
  }

  /** The drag ended: the shown bones become one step. */
  endPreview(side?: Side): void {
    const rig = this.live;
    this.live = null;
    if (!rig) return;
    this.edit(rig, { side });
  }

  /** The drag was called off (Esc): back to the newest step. */
  cancelPreview(): void {
    if (!this.live) return;
    this.live = null;
    this.refresh();
  }

  /**
   * One edit: `rig` becomes the newest step. Edits that move or add stars (`made: 'hand'`) make the
   * student the author and clear Amble's guess.
   */
  edit(rig: RigData, o: { coalesce?: string; side?: Side } = {}): void {
    const s = this.stack;
    if (!s || this.view.busy) return;
    if (rig === s.present.rig) return this.refresh();
    const prev = s.present;
    const step: BonesStep = rig.made === 'hand' ? { rig, made: 'hand', confidence: 1, issues: [], notes: [] } : { ...prev, rig };
    this.stack = commit(s, step, { coalesce: o.coalesce });
    if (o.side === 'L' || o.side === 'R') this.lastSide = o.side;
    this.changed(prev.rig);
  }

  /** Ends a burst of nudges (a star was dropped or left), so the next nudge is a new step. */
  settle(): void {
    if (this.stack) this.stack = settle(this.stack);
  }

  private changed(prev: RigData): void {
    const rig = this.stack?.present.rig;
    if (!rig) return;
    if (hashRig(prev) !== hashRig(rig)) this.scheduleBind();
    else if (this.view.bound && (prev.facing !== rig.facing || prev.anchor[0] !== rig.anchor[0] || prev.anchor[1] !== rig.anchor[1])) {
      // the mesh is the same: the preview only needs the new facing
      this.view = { ...this.view, bound: { ...this.view.bound, rig } };
    }
    this.scheduleSave();
    this.refresh();
  }

  undo(): void {
    if (!this.stack || this.view.busy || !canUndo(this.stack)) return;
    this.live = null;
    const prev = this.stack.present.rig;
    this.stack = undo(this.stack);
    this.changed(prev);
  }

  redo(): void {
    if (!this.stack || this.view.busy || !canRedo(this.stack)) return;
    this.live = null;
    const prev = this.stack.present.rig;
    this.stack = redo(this.stack);
    this.changed(prev);
  }

  /** Mirror sides: false when there was nothing to copy. */
  mirror(): boolean {
    const rig = this.stack?.present.rig;
    if (!rig) return false;
    const next = mirrorBones(rig, this.lastSide);
    if (next === rig) return false;
    this.edit(next);
    return true;
  }

  /** A wiggly bit dragged out of a star (or a point on the drawing) to `to`; returns its end star's id. */
  addWiggly(from: string | Point, to: Point): string | null {
    const rig = this.stack?.present.rig;
    if (!rig) return null;
    const next = addDynamic(rig, from, to);
    if (next === rig) return null;
    this.edit(next);
    return newestTip(next);
  }

  /** A wiggly bit from the keyboard, growing out of a star; returns its end star's id. */
  addWigglyFrom(jointId: string): string | null {
    const rig = this.stack?.present.rig;
    if (!rig) return null;
    const next = keyboardWiggly(rig, jointId);
    if (next === rig) return null;
    this.edit(next);
    return newestTip(next);
  }

  /** Remove: how many bones went (0 when it was the last one). */
  removeBone(name: string): number {
    const rig = this.stack?.present.rig;
    if (!rig) return 0;
    const { rig: next, removed } = removeWithCount(rig, name);
    if (removed) this.edit(next);
    return removed;
  }

  /** "Something I'm holding": the bone moves as one stiff piece. */
  setHolding(name: string, held: boolean): void {
    const rig = this.stack?.present.rig;
    if (rig) this.edit(setRigid(rig, name, held));
  }

  /** Bouncy and Speedy for one move; a slider drag is one step. */
  setTweak(clip: string, tweak: AnimTweak, which: 'amount' | 'speed'): void {
    const rig = this.stack?.present.rig;
    if (!rig) return;
    const current = rig.anims?.[clip] ?? {};
    this.edit(setTweak(rig, clip, { ...current, ...tweak }), { coalesce: `tweak:${clip}:${which}` });
  }

  /** What is it? A new kind re-fits (keeping hand-placed stars as hints); a new facing just turns. */
  async setKindFacing(kind: CharacterKind, facing: Facing): Promise<void> {
    const src = this.source;
    if (!src || this.view.busy) return;
    const current = this.stack?.present;
    if (!current) return this.findBones(kind, facing);
    const f = rigFacing(facing);
    if (kind === current.rig.kind) {
      if (f !== current.rig.facing) this.edit(setFacing(current.rig, f));
      return;
    }
    this.set({ busy: 'refit' });
    try {
      const r = await rigWorker.setKind(src.rig, current.rig, kind, { facing: f, lane: 'bones-fit' });
      if (this.disposed) return;
      this.commitReply(r, r.rig.made === 'hand' ? 'hand' : 'auto');
    } catch (err) {
      if (!isSuperseded(err)) {
        console.warn('Bones could not change the kind:', err);
        showToast(t('bones.statusFailed'), { kind: 'error' });
      }
    } finally {
      this.set({ busy: null });
    }
  }

  private commitReply(r: Pick<RigReply, 'rig' | 'confidence' | 'issues' | 'notes'>, made: RigMade, replace = false): void {
    if (!this.stack) {
      this.stack = createStack(stepOf(r, made));
      this.openedRig ??= JSON.stringify(r.rig);
      this.refresh({ needsKind: false, failed: false });
      this.scheduleBind(0);
      this.scheduleSave();
      return;
    }
    const prev = this.stack.present.rig;
    this.stack = commit(this.stack, stepOf(r, made), { replace });
    this.changed(prev);
  }

  /**
   * Magic bones: a fresh local auto-rig; then, when the district allows it and the student says OK for
   * this drawing, the AI helper's joint hints from a plain outline. One press is one undo step.
   */
  async magic(): Promise<void> {
    const src = this.source;
    const record = this.record;
    if (!src || !record || this.view.busy) return;
    let send = false;
    if (aiHintsAllowed(getState().config.ai, this.services.ai.status())) {
      const answer = await this.consent.answer(record.id);
      if (answer === 'yes') send = true;
      else if (answer === 'ask') {
        send = await confirmUser({ title: t('bones.consentTitle'), body: t('bones.consentBody'), ok: t('bones.consentSend'), cancel: t('bones.consentHere') });
        await this.consent.remember(record.id, send);
      }
    }
    if (this.disposed) return;
    const current = this.stack?.present.rig ?? null;
    this.set({ busy: 'refit', needsKind: false, failed: false });
    try {
      const kind: CharacterKind = current?.kind ?? (record.rig === 'none' ? 'blob' : record.rig);
      const local = current
        ? await rigWorker.magicBones(src.rig, current, { lane: 'bones-fit' })
        : await rigWorker.autoRig(src.rig, { kind, lane: 'bones-fit' });
      if (this.disposed) return;
      this.set({ busy: null });
      this.commitReply(local, 'auto');
      if (!send) return;
      this.set({ busy: 'asking' });
      const hints = await this.askHints(local.rig.kind);
      if (this.disposed) return;
      if (!hints || !Object.keys(hints).length) {
        showToast(t('bones.aiNoHelp'));
        return;
      }
      this.set({ busy: 'refit' });
      const helped = await rigWorker.magicBones(src.rig, local.rig, { hints, lane: 'bones-fit' });
      if (this.disposed) return;
      this.set({ busy: null, aiHelped: true });
      this.commitReply(helped, 'ai', true);
    } catch (err) {
      if (isSuperseded(err)) return;
      console.warn('Magic bones failed:', err);
      if (!this.stack) this.set({ needsKind: true, failed: true });
      else showToast(t('bones.statusFailed'), { kind: 'error' });
    } finally {
      this.set({ busy: null });
    }
  }

  /** The outline goes to the AI helper (the only picture ever sent); its hints come back in art px. */
  private async askHints(kind: CharacterKind): Promise<JointHints | null> {
    const src = this.source;
    if (!src) return null;
    try {
      const outline = visionSilhouette(await decodePixels(src.flat), 256);
      const png = await encodePng(outline);
      const hints = await this.services.ai.rigHints(png, kind, { signal: this.abort.signal });
      return hints ? scaleHints(hints, outline.width, outline.height, src.w, src.h) : null;
    } catch (err) {
      console.warn('The AI helper gave no joint hints:', err);
      return null;
    }
  }

  // ---------------------------------------------------------------- binding and saving

  private scheduleBind(delay = BIND_DELAY_MS): void {
    clearTimeout(this.bindTimer);
    this.bindTimer = setTimeout(() => void this.bindNow(), delay);
  }

  private async bindNow(): Promise<void> {
    const src = this.source;
    const want = this.stack?.present.rig;
    if (!src || !want || this.disposed) return;
    try {
      const bound = await rigWorker.bind(src.rig, want, { lane: 'bones-bind' });
      const now = this.stack?.present.rig;
      if (this.disposed || !now) return;
      // a newer edit changed the bones meanwhile: its own bind is on the way
      if (hashRig(now) !== hashRig(want)) return;
      // the bind cache may hand back older facing and tweaks: the mesh is the same, the rig is ours
      this.set({ bound: { ...bound, rig: now } });
    } catch (err) {
      if (!isSuperseded(err)) console.warn('Bones could not bind the drawing:', err);
    }
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), SAVE_DELAY_MS);
  }

  /** Writes the newest bones into the drawing's record (one commit). */
  saveNow(): Promise<void> {
    clearTimeout(this.saveTimer);
    const record = this.record;
    const step = this.stack?.present;
    if (!record || !step || step === this.savedStep) return this.saving;
    const next: ArtRecord = {
      ...record,
      rig: step.rig.kind,
      facing: facingWord(step.rig.facing),
      rigData: step.rig,
      rigInfo: { made: step.made, confidence: step.confidence, notes: step.notes },
      updatedAt: Date.now(),
    };
    this.record = next;
    this.savedStep = step;
    const job = this.saving.then(() => this.services.store.commit({ art: [next] }));
    this.saving = job.then(
      () => this.set({ saveError: false }),
      (err: unknown) => {
        console.warn('Bones could not save:', err);
        this.savedStep = null;
        if (!this.view.saveError) showToast(t('bones.saveFailed'), { kind: 'error' });
        this.set({ saveError: true });
      },
    );
    return this.saving;
  }

  /** Whether the bones differ from when the student arrived. */
  get changedSinceOpen(): boolean {
    const rig = this.stack?.present.rig;
    return !!rig && this.openedRig !== null && JSON.stringify(rig) !== this.openedRig;
  }

  /**
   * Leaving (Done, ◂ Drawing, or the screen closing): saves, and when the bones changed in a world,
   * hot-swaps them into the running game and records the footstep "You fixed Pip's bones".
   */
  async finish(): Promise<void> {
    if (this.finished) return this.saving;
    this.finished = true;
    this.live = null;
    await this.saveNow();
    const rig = this.stack?.present.rig;
    if (!rig || !this.record || !this.source || !this.changedSinceOpen || 'artId' in this.target) return;
    const { worldId, key } = this.target;
    const { store, history, player } = this.services;
    if (getState().session.world?.id === worldId) player.swapArt(drawnArtOf(key, this.source, rig));
    try {
      const world = await store.worlds.get(worldId);
      if (!world) return;
      const next = await history.record(world, { kind: 'bones', by: 'student', text: t('bones.stepFixed', { name: this.record.name }), cast: key });
      await store.commit({ worlds: [next] });
      syncSession(next);
    } catch (err) {
      console.warn('Bones could not record the footstep:', err);
    }
  }

  /** The screen closed: stops work, and finishes in the background (never loses the bones). */
  dispose(): void {
    if (this.disposed) return;
    clearTimeout(this.bindTimer);
    this.abort.abort();
    const hadWork = !!this.stack;
    this.disposed = true;
    this.listeners.clear();
    if (hadWork && !this.finished) void this.finish();
  }
}
