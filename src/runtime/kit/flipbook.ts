/**
 * Flipbook moves (§7.12): a student can draw the pages of one move ("Pages for Attack") in the Desk's
 * Flipbook. The drawing arrives with `frames` (an atlas, where each page sits, the move and its pages per
 * second); this wraps the character's visual so that while that move plays, the pages show instead of the
 * bones, and the bones animate every other move. Nothing else in the kit changes: the wrapper is a
 * `RiggedCharacter` like the one it wraps.
 *
 * The move is "playing" when the game asked for it (`play('attack')`) or when the bones picked it by
 * themselves (walk, run, idle from the body's movement), so both one-shots and gaits can be flipbooks.
 * One-shots show their pages once; gaits loop them.
 */
import Phaser from 'phaser';
import { resolveClip } from '../../play/kit/synonyms';
import type { DrawnImage } from '../shell/assets';
import type { RiggedCharacter } from './rigged';

const ONE_SHOTS = new Set(['attack', 'shoot', 'hurt', 'land', 'die', 'cheer', 'wave']);

let serial = 0;

class FlipbookVisual implements RiggedCharacter {
  readonly object: Phaser.GameObjects.Container;
  /** The bones' own object, in a box that can hide. */
  private readonly bones: Phaser.GameObjects.Container;
  private readonly image: Phaser.GameObjects.Image;
  private readonly texture: string;
  private readonly move: string;
  private readonly beat: number;
  private readonly sheet: NonNullable<DrawnImage['frames']>['sheet'];
  private readonly total: number;
  private clock = 0;
  /** A one-shot asked for with `play` shows its pages once, then the bones come back. */
  private forced = false;
  private page = -1;
  private facing: 1 | -1 = 1;
  private readonly pageScale: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly inner: RiggedCharacter,
    frames: NonNullable<DrawnImage['frames']>,
    scale: number,
  ) {
    this.move = resolveClip(frames.move) ?? frames.move;
    this.beat = 1000 / Math.max(1, Math.min(30, frames.fps));
    this.sheet = frames.sheet;
    // Pages drawn smaller than the flat picture (a shrunk atlas) are scaled back up.
    this.pageScale = scale / (frames.sheet.k ?? 1);
    this.total = this.sheet.frames.reduce((n, f) => n + f.hold, 0);
    this.texture = `~flip:${++serial}`;
    const tex = scene.textures.addCanvas(this.texture, toCanvas(frames.atlas));
    this.sheet.frames.forEach((f, i) => tex?.add(String(i), 0, f.x, f.y, f.w, f.h));
    this.image = new Phaser.GameObjects.Image(scene, 0, 0, this.texture, '0');
    this.image.setVisible(false);
    this.bones = new Phaser.GameObjects.Container(scene, 0, 0, [inner.object]);
    this.object = new Phaser.GameObjects.Container(scene, 0, 0, [this.bones, this.image]);
  }

  get clip(): string {
    return this.inner.clip;
  }

  private get active(): boolean {
    return this.forced || resolveClip(this.inner.clip) === this.move;
  }

  play(clip: string, opts?: { loop?: boolean; speed?: number; fade?: number }): void {
    this.inner.play(clip, opts);
    if ((resolveClip(clip) ?? clip) !== this.move) {
      this.forced = false;
      return;
    }
    this.clock = 0;
    this.forced = ONE_SHOTS.has(this.move) || opts?.loop === false;
  }

  face(dir: 1 | -1): void {
    this.facing = dir;
    this.inner.face(dir);
    this.image.setScale(this.pageScale * dir, this.pageScale);
  }

  follow(body: Parameters<RiggedCharacter['follow']>[0]): void {
    this.inner.follow(body);
  }

  setTint(color: number | null): void {
    this.inner.setTint(color);
    if (color === null) this.image.clearTint();
    else this.image.setTintFill(color);
  }

  /** The page at the flipbook's clock (pages shown `hold` beats each). */
  private pageAt(ms: number, loop: boolean): number {
    let beat = Math.floor(ms / this.beat);
    if (loop) beat %= this.total;
    else if (beat >= this.total) return -1;
    for (let i = 0; i < this.sheet.frames.length; i++) {
      beat -= this.sheet.frames[i].hold;
      if (beat < 0) return i;
    }
    return this.sheet.frames.length - 1;
  }

  update(dtMs: number): void {
    this.inner.update(dtMs);
    const on = this.active;
    if (on) {
      this.clock += dtMs;
      const page = this.pageAt(this.clock, !this.forced);
      if (page < 0) {
        // A one-shot's last page: the bones take over again.
        this.forced = false;
        this.clock = 0;
      } else if (page !== this.page) this.showPage(page);
    }
    const shown = this.active;
    this.image.setVisible(shown);
    this.bones.setVisible(!shown);
    if (!shown) this.page = -1;
  }

  private showPage(i: number): void {
    const f = this.sheet.frames[i];
    const [ax, ay] = this.sheet.anchor;
    this.page = i;
    this.image.setFrame(String(i));
    // The page's anchor (the feet) sits where the bones' anchor is: the container's origin.
    this.image.setOrigin((ax - f.ox) / f.w, (ay - f.oy) / f.h);
    this.image.setScale(this.pageScale * this.facing, this.pageScale);
  }

  destroy(): void {
    this.inner.destroy();
    this.image.destroy();
    this.object.destroy();
    if (this.scene.textures.exists(this.texture)) this.scene.textures.remove(this.texture);
  }
}

function toCanvas(src: HTMLCanvasElement | ImageBitmap): HTMLCanvasElement {
  if (src instanceof HTMLCanvasElement) return src;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')?.drawImage(src, 0, 0);
  return c;
}

/**
 * The character's visual with its flipbook, when the drawing has one (else the visual as it is). `scale`
 * turns the drawing's pixels into the visual's units: 1 for rigged drawings (the kit scales them), the
 * sprite's own scale for drawings without bones.
 */
export function withFlipbook(scene: Phaser.Scene, visual: RiggedCharacter, drawn: DrawnImage | undefined, scale: number): RiggedCharacter {
  if (!drawn?.frames) return visual;
  try {
    return new FlipbookVisual(scene, visual, drawn.frames, scale);
  } catch {
    return visual;
  }
}
