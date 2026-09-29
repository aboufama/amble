/**
 * The art registry of one running game: which pictures the game declared and used, the student's drawings,
 * and the stand-ins for the rest.
 *
 * Every art key K gets two textures:
 * - `K`: exactly the art's in-game size (the stand-in painted at 1x, or the drawing fitted into the box),
 *   so plain Phaser code (`this.add.image(x, y, 'tree')`) shows it at the right size either way;
 * - `K~hd`: the drawing at full resolution (or the stand-in painted at 2x), which the kit's own sprites use
 *   scaled to the box, so things stay crisp when the stage is big or the art grows.
 * Stand-in characters are puppets made of part textures (`~g:K:<bone>`), with a name tag (`~tag:K`).
 */
import Phaser from 'phaser';
import type { DrawnImage } from '../shell/assets';
import { pixelSize } from '../shell/assets';
import { env } from './env';
import { fitModeFor, fitSize } from './fit';
import { paintBackground, paintBadgeTexture, paintTag, paintThing, paintTile, paintTileEdge } from './ghost/paint';
import { paintCharacter, paintParts } from './ghost/parts';
import type { PuppetPart } from './ghost/puppet';
import { templateFor } from './ghost/templates';
import { normalizeSpec, toArtNeed, type ArtSpec } from './spec';
import { addTexture, swapTexture, type TexSource } from './swap';

export const HD = '~hd';
const GHOST_SCALE = 2;

/** Something on screen that shows an art key and wants to know when its drawing changes. */
export interface ArtListener {
  readonly key: string;
  artChanged(): void;
}

const registries = new WeakMap<Phaser.Game, ArtRegistry>();

export function registryFor(game: Phaser.Game): ArtRegistry | undefined {
  return registries.get(game);
}

function isInternalKey(key: string): boolean {
  return key.startsWith('__') || key.startsWith('~') || key.includes('~retired') || key.endsWith(HD) || key === 'amble-fx';
}

export class ArtRegistry {
  readonly specs = new Map<string, ArtSpec>();
  private readonly used = new Set<string>();
  private readonly reported = new Set<string>();
  private readonly parts = new Map<string, PuppetPart[]>();
  private readonly sheets = new Map<string, { frameWidth: number; frameHeight: number }>();
  private readonly listeners = new Set<ArtListener>();
  /** Called when the set of used/drawn art changes (the manifest is re-sent). */
  onChange: (() => void) | null = null;

  constructor(readonly game: Phaser.Game, declared?: unknown) {
    registries.set(game, this);
    if (typeof declared === 'object' && declared !== null) {
      for (const [key, spec] of Object.entries(declared as Record<string, unknown>)) {
        if (/^[A-Za-z_][\w-]{0,63}$/.test(key)) this.specs.set(key, normalizeSpec(key, spec, true));
      }
    }
    this.patchTextureLookup();
    for (const key of env().drawn.keys()) this.installDrawn(key);
  }

  spec(key: string): ArtSpec {
    let s = this.specs.get(key);
    if (!s) {
      const sheet = this.sheets.get(key);
      s = normalizeSpec(key, sheet ? { w: sheet.frameWidth, h: sheet.frameHeight } : undefined, false);
      this.specs.set(key, s);
    }
    return s;
  }

  drawn(key: string): DrawnImage | undefined {
    return env().drawn.get(key);
  }

  isDrawn(key: string): boolean {
    return !!this.drawn(key);
  }

  /** Notes that the game uses a key; asks the editor for the drawing the first time (if it is missing). */
  use(key: string): void {
    if (isInternalKey(key)) return;
    const first = !this.used.has(key);
    this.used.add(key);
    if (!this.isDrawn(key) && !this.reported.has(key)) {
      this.reported.add(key);
      env().post({ type: 'artMissing', need: toArtNeed(this.spec(key), { used: true, drawn: false }) });
    }
    if (first) this.onChange?.();
  }

  isUsed(key: string): boolean {
    return this.used.has(key);
  }

  /** The texture key at the art's own size (for plain Phaser code, tile sprites and Matter bodies). */
  raw(key: string): string {
    this.use(key);
    const tm = this.game.textures;
    if (!tm.exists(key)) this.addRaw(key);
    return key;
  }

  /** The crisp texture key for the kit's own sprites (scale it to the art's box). */
  hd(key: string): string {
    this.use(key);
    const tm = this.game.textures;
    const k = key + HD;
    if (!tm.exists(k)) addTexture(tm, k, this.hdSource(key));
    return k;
  }

  /** Part textures of a stand-in character's puppet. */
  ghostParts(key: string): PuppetPart[] {
    const known = this.parts.get(key);
    if (known) return known;
    const spec = this.spec(key);
    const tm = this.game.textures;
    const out = paintParts(spec, templateFor(spec.rig, spec.w, spec.h), GHOST_SCALE).map((p) => {
      const texture = `~g:${key}:${p.bone}`;
      if (tm.exists(texture)) tm.remove(texture);
      const tex = addTexture(tm, texture, p.canvas);
      // One frame per dash phase: the puppet cycles them to march the outline.
      if (tex) for (let i = 0; i < p.frames; i++) tex.add(String(i), 0, i * p.frameWidth, 0, p.frameWidth, p.canvas.height);
      return { bone: p.bone, texture, frames: p.frames, originX: p.originX, originY: p.originY, scale: 1 / GHOST_SCALE, depth: p.depth };
    });
    this.parts.set(key, out);
    return out;
  }

  /** The floating "NAME · draw me" tag of a stand-in (the name only in exported pages). */
  tag(key: string): string {
    const k = `~tag:${key}`;
    const tm = this.game.textures;
    if (!tm.exists(k)) addTexture(tm, k, paintTag(this.spec(key).name, GHOST_SCALE, !env().standalone));
    return k;
  }

  /** The dashed top edge a terrain stand-in shows along the top of its platforms. */
  edge(key: string): string {
    const k = `~edge:${key}`;
    const tm = this.game.textures;
    if (!tm.exists(k)) addTexture(tm, k, paintTileEdge(this.spec(key), GHOST_SCALE));
    return k;
  }

  /** The small pencil badge other stand-ins of the same key wear. */
  badge(): string {
    const k = '~badge';
    const tm = this.game.textures;
    if (!tm.exists(k)) addTexture(tm, k, paintBadgeTexture(GHOST_SCALE));
    return k;
  }

  /** Called by the Loader hook: `this.load.spritesheet('dude', 'dude.png', { frameWidth, frameHeight })`. */
  noteSheet(key: string, frameWidth: number, frameHeight: number): void {
    if (frameWidth > 0 && frameHeight > 0) this.sheets.set(key, { frameWidth, frameHeight });
  }

  listen(l: ArtListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  // ---------------------------------------------------------------- stand-ins and drawings

  private ghostSource(key: string, scale: number): HTMLCanvasElement {
    const spec = this.spec(key);
    if (spec.kind === 'background') return paintBackground(spec, this.game.config.backgroundColor.color, !env().standalone);
    if (spec.kind === 'terrain') return paintTile(spec, scale);
    if (spec.kind === 'character') return paintCharacter(spec, scale);
    return paintThing(spec, scale);
  }

  private hdSource(key: string): TexSource {
    const d = this.drawn(key);
    return d ? d.image : this.ghostSource(key, GHOST_SCALE);
  }

  /** The drawing fitted into the art's box (the `K` texture of a drawn key). */
  private fittedDrawing(key: string, d: DrawnImage): HTMLCanvasElement {
    const spec = this.spec(key);
    const { w, h } = pixelSize(d.image);
    const size = fitSize(fitModeFor(spec.kind), spec.w, spec.h, w, h);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(size.w));
    c.height = Math.max(1, Math.round(size.h));
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(d.image, 0, 0, c.width, c.height);
    }
    return c;
  }

  private rawSource(key: string): HTMLCanvasElement {
    const d = this.drawn(key);
    return d ? this.fittedDrawing(key, d) : this.ghostSource(key, 1);
  }

  private addRaw(key: string): void {
    const tm = this.game.textures;
    const sheet = this.sheets.get(key);
    const src = this.rawSource(key);
    if (sheet) {
      // A spritesheet: repeat the picture so frame numbers the game asks for exist.
      const frames = 8;
      const strip = document.createElement('canvas');
      strip.width = sheet.frameWidth * frames;
      strip.height = sheet.frameHeight;
      const ctx = strip.getContext('2d');
      for (let i = 0; i < frames && ctx; i++) ctx.drawImage(src, i * sheet.frameWidth, 0, sheet.frameWidth, sheet.frameHeight);
      tm.addSpriteSheet(key, strip as unknown as HTMLImageElement, { frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight });
      return;
    }
    addTexture(tm, key, src);
  }

  /** A drawing is loaded (at boot) for `key`: register its textures. */
  private installDrawn(key: string): void {
    const tm = this.game.textures;
    if (!tm.exists(key)) this.addRaw(key);
    if (!tm.exists(key + HD)) {
      const d = this.drawn(key);
      if (d) addTexture(tm, key + HD, d.image);
    }
  }

  /**
   * The student's drawing for `key` changed (or was removed): swap both textures in place and tell every
   * character showing it. Returns how many objects changed.
   */
  refresh(key: string): number {
    const tm = this.game.textures;
    let touched = 0;
    // Only textures that exist are swapped; the others are made from the new drawing when first needed.
    if (tm.exists(key) && !this.sheets.has(key)) touched += swapTexture(this.game, key, this.rawSource(key));
    if (tm.exists(key + HD)) touched += swapTexture(this.game, key + HD, this.hdSource(key));
    for (const l of [...this.listeners]) {
      if (l.key !== key) continue;
      l.artChanged();
      touched++;
    }
    if (!this.isDrawn(key)) this.reported.delete(key);
    this.onChange?.();
    return touched;
  }

  /** Every key the game declared or used, for the editor's manifest. */
  needs(): ArtSpec[] {
    const keys = new Set([...this.specs.keys(), ...this.used]);
    return [...keys].map((k) => this.spec(k));
  }

  /** Unknown texture keys become stand-ins (and art requests) instead of Phaser's green "missing" box. */
  private patchTextureLookup(): void {
    const tm = this.game.textures;
    const realGet = tm.get.bind(tm);
    tm.get = ((key: string | Phaser.Textures.Texture | Phaser.Textures.Frame) => {
      if (typeof key === 'string' && key && !isInternalKey(key) && !tm.exists(key)) {
        try {
          this.raw(key);
        } catch {
          /* fall through to Phaser's __MISSING texture */
        }
      }
      return realGet(key);
    }) as typeof tm.get;
  }
}
