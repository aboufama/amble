/**
 * A character: the student's drawing on bones (or its "just bones" stand-in until drawn), behaving like an
 * Arcade sprite. The container carries the physics body and the game-facing API; a mount inside it holds the
 * visual (a RiggedCharacter), so squash, flips and scaling deform the picture, never the hitbox.
 */
import Phaser from 'phaser';
import type { Role } from '../../play/protocol';
import { pixelSize } from '../shell/assets';
import { onGround } from './actors';
import type { ArtListener } from './art';
import { colorInt } from './color';
import { env } from './env';
import { Puppet } from './ghost/puppet';
import { templateFor, type Template } from './ghost/templates';
import { riggedFactory, type RiggedCharacter } from './rigged';
import type { ArtSpec } from './spec';
import type { Kit } from './state';
import { CLIP_NAMES, resolveClip } from './synonyms';
import { arcadeBody, type Point } from './types';

/** One-shot clips: they play once over the current movement. */
const ONE_SHOTS = new Set(['attack', 'shoot', 'hurt', 'land', 'die']);

const SPRITE_TEMPLATE: Template = { kind: 'object', bones: [{ name: 'body', parent: null, x: 0, y: 0, rest: 0, length: 0, depth: 1 }] };

/** Where `attach()` puts things, as fractions of the character's box (x toward its facing, y down from the centre). */
const ANCHORS: Record<string, { x: number; y: number; depth: number }> = {
  head: { x: 0.05, y: -0.42, depth: 1 },
  hat: { x: 0, y: -0.5, depth: 1 },
  hand: { x: 0.42, y: 0.02, depth: 1 },
  handR: { x: 0.42, y: 0.02, depth: 1 },
  handL: { x: -0.36, y: 0.02, depth: -1 },
  back: { x: -0.3, y: -0.1, depth: -1 },
  body: { x: 0, y: 0, depth: 1 },
  feet: { x: 0, y: 0.5, depth: 1 },
};

type Attachable = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform & { setDepth?(d: number): unknown; setFlipX?(f: boolean): unknown };

/** Which character shows the name tag for each key (one tag per key, so crowds stay readable). */
const tagOwners = new Map<string, Character>();

export interface Character
  extends Phaser.Physics.Arcade.Components.Acceleration,
    Phaser.Physics.Arcade.Components.Angular,
    Phaser.Physics.Arcade.Components.Bounce,
    Phaser.Physics.Arcade.Components.Drag,
    Phaser.Physics.Arcade.Components.Enable,
    Phaser.Physics.Arcade.Components.Friction,
    Phaser.Physics.Arcade.Components.Gravity,
    Phaser.Physics.Arcade.Components.Immovable,
    Phaser.Physics.Arcade.Components.Mass,
    Phaser.Physics.Arcade.Components.Velocity {}

export class Character extends Phaser.GameObjects.Container implements ArtListener {
  key: string;
  readonly spec: ArtSpec;
  role: Role;
  facing: 1 | -1 = 1;
  /** Picks idle/walk/run/rise/fall/land from the body's movement (default true). */
  autoAnim = true;
  /** Speed (px/s) at which walking becomes running. */
  runSpeed: number;
  animSpeed = 1;
  /** Growing keeps the feet on the floor (a body grown into the floor would fall through it). */
  keepFeet = true;
  lockFacing = false;
  dashing?: boolean;
  alive = true;
  /** fx.squash deforms this (the picture), never the body. */
  readonly squashScale = { x: 1, y: 1 };
  private visual: RiggedCharacter;
  private readonly mount: Phaser.GameObjects.Container;
  private fit = 1;
  private tagImg: Phaser.GameObjects.Image | null = null;
  private tagKind: 'tag' | 'badge' | null = null;
  private tagForced = false;
  private unlisten: () => void;
  private lookTarget: (Point & { active?: boolean }) | null = null;
  private wasOnGround = true;
  private lastVy = 0;
  private locked = false;
  private dashClip = false;
  private wasDrawn: boolean;
  private readonly attached: Array<{ obj: Attachable; at: { x: number; y: number; depth: number } }> = [];

  constructor(
    scene: Phaser.Scene,
    private readonly kit: Kit,
    x: number,
    y: number,
    key: string,
    o: { role?: Role; autoAnim?: boolean; runSpeed?: number } = {},
  ) {
    super(scene, x, y);
    this.key = key;
    this.spec = kit.art.spec(key);
    this.role = o.role ?? this.spec.role;
    this.autoAnim = o.autoAnim !== false;
    this.runSpeed = o.runSpeed ?? 230;
    this.setSize(this.spec.w, this.spec.h);
    this.mount = new Phaser.GameObjects.Container(scene, 0, this.spec.h / 2);
    this.add(this.mount);
    kit.art.use(key);
    this.wasDrawn = kit.art.isDrawn(key);
    this.visual = this.buildVisual();
    this.unlisten = kit.art.listen(this);
    scene.add.existing(this);
  }

  /** false while it is a stand-in. */
  get drawn(): boolean {
    return this.kit.art.isDrawn(this.key);
  }

  /** Standing on something (respects flipped gravity). */
  get onGround(): boolean {
    return onGround(this.kit, this);
  }

  get flipX(): boolean {
    return this.facing < 0;
  }

  set flipX(v: boolean) {
    this.face(v ? -1 : 1);
  }

  set tint(c: number) {
    this.setTint(c);
  }

  private buildVisual(): RiggedCharacter {
    const reg = this.kit.art;
    const d = reg.drawn(this.key);
    const spec = this.spec;
    let visual: RiggedCharacter | null = null;
    this.fit = 1;
    if (d) {
      const factory = riggedFactory();
      const drawnSpec = reg.spec(this.key);
      if (factory && d.rig && drawnSpec.kind === 'character') {
        try {
          visual = factory(this.scene, 0, 0, { key: this.key, rig: d.rig, image: d.image, layers: d.layers });
          this.fit = spec.h / Math.max(1, pixelSize(d.image).h);
        } catch (err) {
          env().post({ type: 'warn', message: `The bones for ${drawnSpec.name} could not load, so it moves without them (${String(err instanceof Error ? err.message : err).slice(0, 120)}).` });
          visual = null;
        }
      }
      if (!visual) {
        const { h } = pixelSize(d.image);
        const puppet = new Puppet(this.scene, SPRITE_TEMPLATE, 'object', [{ bone: 'body', texture: reg.hd(this.key), originX: 0.5, originY: 1, scale: spec.h / Math.max(1, h), depth: 1 }], spec.h);
        puppet.runSpeed = this.runSpeed;
        visual = puppet;
      }
    } else {
      const puppet = new Puppet(this.scene, templateFor(spec.rig, spec.w, spec.h), spec.rig, reg.ghostParts(this.key), spec.h);
      puppet.runSpeed = this.runSpeed;
      visual = puppet;
    }
    this.mount.add(visual.object);
    visual.face(this.facing);
    if (!this.autoAnim || this.locked) visual.follow(null);
    return visual;
  }

  /** The drawing for this key changed: swap the visual, keep everything else (body, facing, health). */
  artChanged(): void {
    const becameDrawn = !this.wasDrawn && this.drawn;
    this.wasDrawn = this.drawn;
    const clip = this.visual.clip;
    this.visual.destroy();
    this.visual = this.buildVisual();
    if (this.locked || !this.autoAnim) this.visual.play(clip, { loop: true });
    if (becameDrawn && this.active) {
      this.celebrate();
      this.emit('drawn');
    }
    this.updateTag();
  }

  /** The first appearance of a drawing: a quick pop and a puff of confetti. */
  private celebrate(): void {
    const fx = this.kit.fx;
    fx.burst(this.x, this.y, { frames: ['square', 'star'], colors: [0xff6b4a, 0xffd23f, 0x43e6b0, 0x7cc4ff], count: 16, speed: [60, 260], life: 600, size: 0.55, gravity: 300, blend: 'normal' });
    if (env().prefs.reducedMotion) return;
    this.squashScale.x = this.squashScale.y = 0.6;
    this.scene.tweens.add({ targets: this.squashScale, x: 1, y: 1, duration: 300, ease: 'Back.easeOut' });
  }

  /** Plays a clip: idle walk run jump rise fall land dash attack shoot hurt die cheer rage fly glide swim wiggle spin. */
  play(clip: string, o: { once?: boolean; ms?: number; lock?: boolean } = {}): this {
    const name = resolveClip(String(clip));
    if (!name) {
      env().post({ type: 'warn', message: `"${String(clip).slice(0, 30)}" is not a move characters know. Try: ${CLIP_NAMES.slice(0, 12).join(', ')}.` });
      return this;
    }
    const oneShot = ONE_SHOTS.has(name) || o.once === true;
    if (o.lock) {
      this.locked = true;
      this.visual.follow(null);
    } else if (!oneShot && this.locked) {
      this.locked = false;
    }
    this.visual.play(name, { loop: !oneShot });
    return this;
  }

  /** Turns left (-1) or right (1): a quick paper flip. */
  face(dir: number): this {
    if (!dir) return this;
    const f: 1 | -1 = dir < 0 ? -1 : 1;
    if (f !== this.facing) {
      this.facing = f;
      this.visual.face(f);
    }
    return this;
  }

  setFlipX(v: boolean): this {
    return this.face(v ? -1 : 1);
  }

  /** Keeps turning toward a target (null stops). */
  lookAt(target: (Point & { active?: boolean }) | null): this {
    this.lookTarget = target;
    return this;
  }

  setTint(c: unknown): this {
    this.visual.setTint(colorInt(c));
    return this;
  }

  /** Characters flash white (the hurt flash). */
  setTintFill(_c?: unknown): this {
    this.visual.setTint(0xffffff);
    return this;
  }

  clearTint(): this {
    this.visual.setTint(null);
    return this;
  }

  setBodySize(w: number, h: number): this {
    arcadeBody(this)?.setSize(w, h, true);
    return this;
  }

  /** Carries something (a hat, a wand) at a place on the body: head, hat, hand, handL, back, body or feet. */
  attach(obj: Attachable, bone = 'hand'): this {
    const at = ANCHORS[bone] ?? ANCHORS[resolveAnchor(bone)] ?? ANCHORS.hand;
    this.attached.push({ obj, at });
    this.placeAttached();
    return this;
  }

  private placeAttached(): void {
    for (let i = this.attached.length - 1; i >= 0; i--) {
      const { obj, at } = this.attached[i];
      if (!obj.active) {
        this.attached.splice(i, 1);
        continue;
      }
      const sx = Math.abs(this.scaleX);
      const sy = Math.abs(this.scaleY) * this.kit.gravitySign;
      obj.setPosition(this.x + at.x * this.spec.w * sx * this.facing, this.y + at.y * this.spec.h * sy);
      obj.setDepth?.(this.depth + at.depth * 0.5);
      obj.setFlipX?.(this.facing < 0);
    }
  }

  /** Turns into another drawing (a transformation); the body and behaviours stay. */
  setArt(key: string): this {
    if (!key || key === this.key) return this;
    this.unlisten();
    if (tagOwners.get(this.key) === this) tagOwners.delete(this.key);
    this.key = key;
    this.kit.art.use(key);
    this.unlisten = this.kit.art.listen(this);
    this.visual.destroy();
    this.visual = this.buildVisual();
    this.kit.fx.burst(this.x, this.y, { colors: [0xffffff, 0xffd23f], count: 14, speed: [80, 260], life: 400, size: 0.6 });
    return this;
  }

  /** An afterimage of the character (dash trails): a tinted copy of its picture that fades out. */
  afterimage(color = 0x80ffff, alpha = 0.55, ms = 260): void {
    const tex = this.kit.art.hd(this.key);
    const frame = this.scene.textures.getFrame(tex);
    if (!frame) return;
    const s = this.spec.h / Math.max(1, frame.realHeight);
    const g = this.scene.add
      .image(this.x, this.y + (this.spec.h / 2) * this.kit.gravitySign, tex)
      .setOrigin(0.5, this.kit.gravitySign > 0 ? 1 : 0)
      .setScale(s * this.facing * this.scaleX, s * this.kit.gravitySign * this.scaleY)
      .setTintFill(colorInt(color))
      .setAlpha(alpha)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(this.depth - 1);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: ms, onComplete: () => g.destroy() });
  }

  /** `hero.ghost()` in game code: an afterimage (not a stand-in). */
  ghost(color: unknown = 0x80ffff, alpha = 0.55, ms = 260): void {
    this.afterimage(colorInt(color), alpha, ms);
  }

  /** Shows the name tag on every stand-in while the editor has the game paused. */
  forceTag(on: boolean): void {
    this.tagForced = on;
    this.updateTag();
  }

  /** The first stand-in of a key wears the name tag; the others a pencil badge (all tags while paused). */
  private updateTag(): void {
    const owner = tagOwners.get(this.key);
    if (!owner || !owner.active || owner === this) tagOwners.set(this.key, this);
    const want = this.drawn || !this.active ? null : this.tagForced || tagOwners.get(this.key) === this ? 'tag' : 'badge';
    if (want !== this.tagKind) {
      this.tagImg?.destroy();
      this.tagImg = null;
      this.tagKind = want;
      if (want) {
        const tex = want === 'tag' ? this.kit.art.tag(this.key) : this.kit.art.badge();
        // Never flipped with facing; a slight paper tilt.
        this.tagImg = this.scene.add.image(0, 0, tex).setScale(0.5).setDepth(950).setAngle(want === 'tag' ? -3 : 0);
      }
    }
    if (this.tagImg) {
      const up = this.kit.gravitySign > 0 ? -1 : 1;
      const lift = this.tagKind === 'tag' ? 13 : 9;
      this.tagImg.setPosition(this.x, this.y + up * (this.spec.h * Math.abs(this.scaleY) * 0.5 + lift)).setVisible(this.visible && this.alive);
    }
  }

  preUpdate(_time: number, delta: number): void {
    const k = this.kit;
    const b = arcadeBody(this);
    const grav = !!b && b.allowGravity && k.hasGravity;
    if (b && b.enable && this.alive) {
      if (this.dashing && !this.dashClip) {
        this.dashClip = true;
        this.visual.follow(null);
        this.visual.play('dash', { loop: true });
      } else if (!this.dashing && this.dashClip) this.dashClip = false;
      if (this.autoAnim && !this.locked && !this.dashClip) {
        const gs = k.gravitySign;
        const down = gs > 0 ? b.blocked.down || b.touching.down : b.blocked.up || b.touching.up;
        this.visual.follow(grav ? { velocity: { x: b.velocity.x, y: b.velocity.y * gs }, blocked: { down } } : { velocity: { x: b.velocity.x, y: b.velocity.y } });
      }
      if (Math.abs(b.velocity.x) > 12 && !this.lockFacing) this.face(b.velocity.x);
      if (grav) {
        const og = this.onGround;
        if (og && !this.wasOnGround && this.lastVy * k.gravitySign > 280) {
          k.fx.squash(this, 1.3, 0.72, 130);
          k.fx.dust(this);
          this.emit('land');
        }
        this.wasOnGround = og;
        this.lastVy = b.velocity.y;
      }
    }
    const t = this.lookTarget;
    if (t && t.active !== false && (!b || Math.abs(b.velocity.x) < 12)) this.face(t.x - this.x);
    this.visual.update(delta * this.animSpeed);
    if (this.attached.length) this.placeAttached();
    const flip = grav && k.gravitySign < 0 ? -1 : 1;
    this.mount.setPosition(0, (this.spec.h / 2) * flip);
    this.mount.setScale(this.fit * this.squashScale.x, this.fit * this.squashScale.y * flip);
    this.updateTag();
  }

  /** After a scale change: moves the character so the bottom of its body stays where it was. */
  keepFeetOnFloor(oldScaleY: number): void {
    const b = arcadeBody(this);
    if (!b || !this.keepFeet || oldScaleY === this.scaleY || !this.kit) return;
    const bottom = b.offset.y + b.sourceHeight - this.height / 2;
    this.y -= (this.scaleY - oldScaleY) * bottom * this.kit.gravitySign;
  }

  destroy(fromScene?: boolean): void {
    if (tagOwners.get(this.key) === this) tagOwners.delete(this.key);
    this.unlisten?.();
    this.tagImg?.destroy();
    this.tagImg = null;
    this.tagKind = null;
    for (const { obj } of this.attached ?? []) obj.destroy();
    this.visual?.destroy();
    super.destroy(fromScene);
  }
}

// Phaser's typings describe these mixins as interfaces only; at run time they are plain objects of methods.
const A = (Phaser.Physics.Arcade as unknown as { Components: Record<string, object> }).Components;
Object.assign(Character.prototype, A.Acceleration, A.Angular, A.Bounce, A.Drag, A.Enable, A.Friction, A.Gravity, A.Immovable, A.Mass, A.Velocity);

// Scaling a character keeps its feet planted: growing a body around its centre embeds it in the floor, and
// Arcade refuses to separate overlaps bigger than the bodies' motion + OVERLAP_BIAS (4 px).
function findSetter(proto: object, name: string): PropertyDescriptor | null {
  for (let p: object | null = proto; p; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, name);
    if (d) return d;
  }
  return null;
}

for (const name of ['scale', 'scaleY'] as const) {
  const d = findSetter(Phaser.GameObjects.Container.prototype, name);
  if (!d?.set || !d.get) continue;
  const get = d.get;
  const set = d.set;
  Object.defineProperty(Character.prototype, name, {
    configurable: true,
    get,
    set(this: Character, v: number) {
      const old = this.scaleY;
      set.call(this, v);
      this.keepFeetOnFloor(old);
    },
  });
}

/** Other words for the attach points ("hands", "top", "tail"...). */
function resolveAnchor(name: string): string {
  const n = name.toLowerCase();
  if (/hat|top|crown/.test(n)) return 'hat';
  if (/head|face|eye|mouth/.test(n)) return 'head';
  if (/left/.test(n)) return 'handL';
  if (/hand|arm|paw|claw|wand|sword/.test(n)) return 'hand';
  if (/back|tail|cape|wing/.test(n)) return 'back';
  if (/foot|feet|leg|shoe/.test(n)) return 'feet';
  return 'body';
}
