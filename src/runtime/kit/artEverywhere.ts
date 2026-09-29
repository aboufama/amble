/**
 * The student's drawings everywhere in a game (§6.6), not only in the level:
 * - `ui.hearts(hero)` shows lives as little crops of the hero's head when it was drawn on the bones (a
 *   `part:head` layer), with a cream sticker edge; plain hearts otherwise, and again when it is redrawn;
 * - the title card shows the star (`config.star`, default: the hero) doing its idle move under the title;
 * - the win screen shows the hero cheering, the lose screen shows it going down (its `ko`).
 * Installed once per game realm by `installArtEverywhere()` (kit/index.ts).
 */
import Phaser from 'phaser';
import { pixelSize } from '../shell/assets';
import type { ArtRegistry } from './art';
import { env } from './env';
import { Puppet } from './ghost/puppet';
import { templateFor } from './ghost/templates';
import { riggedFactory, type RiggedCharacter } from './rigged';
import { AmbleScene } from './scene';
import type { Kit } from './state';
import { addTexture } from './swap';
import { Ui } from './ui';

const HEAD_PX = 24;
const EDGE = 2;
const CREAM = '#fdf8ec';

/** The Ui's kit (a private field of Ui, read here because this file extends Ui). */
function kitOf(ui: Ui): Kit {
  return (ui as unknown as { k: Kit }).k;
}

// ------------------------------------------------------------------ hearts from the head

/** The head part cropped to its ink, fitted in HEAD_PX, with a cream die-cut edge (null: no head layer). */
function headCanvas(reg: ArtRegistry, key: string): HTMLCanvasElement | null {
  const d = reg.drawn(key);
  const layer = d?.layers?.['part:head'];
  if (!layer) return null;
  const { w, h } = pixelSize(layer as HTMLCanvasElement);
  const probe = document.createElement('canvas');
  probe.width = w;
  probe.height = h;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  if (!pctx) return null;
  pctx.drawImage(layer, 0, 0);
  const px = pctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] < 24) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const s = HEAD_PX / Math.max(bw, bh);
  const size = HEAD_PX + EDGE * 2 + 2;
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  const dw = bw * s;
  const dh = bh * s;
  const dx = (size - dw) / 2;
  const dy = (size - dh) / 2;
  // The sticker edge: the head's shape drawn in cream, nudged around a small circle, then the head on top.
  const edge = document.createElement('canvas');
  edge.width = edge.height = size;
  const ectx = edge.getContext('2d');
  if (ectx) {
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      ectx.drawImage(probe, x0, y0, bw, bh, dx + Math.cos(t) * EDGE, dy + Math.sin(t) * EDGE, dw, dh);
    }
    ectx.globalCompositeOperation = 'source-in';
    ectx.fillStyle = CREAM;
    ectx.fillRect(0, 0, size, size);
    ctx.drawImage(edge, 0, 0);
  }
  ctx.drawImage(probe, x0, y0, bw, bh, dx, dy, dw, dh);
  return out;
}

interface HeartsBar {
  icons: Phaser.GameObjects.Image[];
}

function useHeads(ui: Ui, bar: HeartsBar, key: string): void {
  const k = kitOf(ui);
  const apply = () => {
    const d = k.art.drawn(key);
    const tex = `~heart:${key}:${d?.version ?? 0}`;
    const tm = ui.s.textures;
    let head = tm.exists(tex);
    if (!head && d) {
      const c = headCanvas(k.art, key);
      head = !!c && !!addTexture(tm, tex, c);
    }
    // Heads are a little wider than hearts: they get a little more room.
    bar.icons.forEach((icon, i) => {
      if (!icon.active) return;
      if (head) icon.setTexture(tex).setX(26 + i * 36);
      else icon.setTexture('amble-fx', 'heart').setX(26 + i * 30);
    });
  };
  apply();
  const unlisten = k.art.listen({ key, artChanged: apply });
  k.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, unlisten);
}

// ------------------------------------------------------------------ the star on the title and end screens

/** The drawing on its bones, its stand-in, or a plain picture, standing with its feet at (x, y). */
function figure(scene: Phaser.Scene, k: Kit, key: string, x: number, y: number, height: number): { root: Phaser.GameObjects.Container; visual: RiggedCharacter | null } {
  const root = scene.add.container(x, y).setDepth(9502);
  const shadow = scene.add.image(0, 0, 'amble-fx', 'dot').setTint(0x000000).setAlpha(0.35).setScale(height / 40, height / 180);
  root.add(shadow);
  const spec = k.art.spec(key);
  const d = k.art.drawn(key);
  let visual: RiggedCharacter | null = null;
  let scale = height / Math.max(1, spec.h);
  if (spec.kind === 'character') {
    const factory = riggedFactory();
    if (d?.rig && factory) {
      try {
        visual = factory(scene, 0, 0, { key, rig: d.rig, image: d.image, layers: d.layers });
        scale = height / Math.max(1, pixelSize(d.image).h);
      } catch {
        visual = null;
      }
    }
    if (!visual && !d) visual = new Puppet(scene, templateFor(spec.rig, spec.w, spec.h), spec.rig, k.art.ghostParts(key), spec.h);
  }
  if (visual) {
    visual.object.setScale(scale);
    root.add(visual.object);
  } else {
    const tex = k.art.hd(key);
    const fr = scene.textures.getFrame(tex);
    const s = fr ? height / Math.max(1, fr.realHeight) : 1;
    root.add(scene.add.image(0, 0, tex).setOrigin(0.5, 1).setScale(s));
  }
  return { root, visual };
}

/** Plays a move on a figure in the (real-time) HUD scene until the level ends; `freezeMs` stops it there. */
function perform(k: Kit, f: { root: Phaser.GameObjects.Container; visual: RiggedCharacter | null }, move: string, o: { loop: boolean; freezeMs?: number }): void {
  const ui = k.uiScene;
  const v = f.visual;
  if (!v) {
    if (move !== 'idle' && !env().prefs.reducedMotion) ui.tweens.add({ targets: f.root, y: f.root.y - 16, yoyo: true, repeat: move === 'die' ? 0 : -1, duration: 260, ease: 'Sine.easeOut' });
    return;
  }
  v.play(move, { loop: o.loop });
  let t = 0;
  const tick = (_time: number, delta: number) => {
    if (!f.root.active) {
      ui.events.off(Phaser.Scenes.Events.UPDATE, tick);
      return;
    }
    // Counted like the rig counts time (at most 100 ms a frame), so a slow frame never skips the pose.
    t += Math.min(100, delta);
    if (o.freezeMs === undefined || t < o.freezeMs) v.update(env().prefs.reducedMotion && move === 'idle' ? delta * 0.5 : delta);
  };
  ui.events.on(Phaser.Scenes.Events.UPDATE, tick);
  k.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    ui.events.off(Phaser.Scenes.Events.UPDATE, tick);
    v.destroy();
    f.root.destroy();
  });
}

/** The art key that stars: `config.star`, the hero, or the first declared hero. */
function starKey(k: Kit): string | null {
  if (k.cfg.star) return k.cfg.star;
  if (k.hero?.key) return k.hero.key;
  for (const s of k.art.specs.values()) if (s.declared && s.role === 'hero') return s.key;
  return null;
}

function titleStar(scene: AmbleScene): void {
  const k = scene.__kit;
  if (!k || k.state !== 'title') return;
  const key = starKey(k);
  if (!key) return;
  const ui = k.uiScene;
  const f = figure(ui, k, key, ui.scale.width / 2, ui.scale.height - 46, Math.min(150, ui.scale.height * 0.28));
  perform(k, f, 'idle', { loop: true });
  // The title goes when play starts: the star hops off with it.
  scene.events.once('start', () => {
    if (!f.root.active) return;
    ui.tweens.add({ targets: f.root, y: f.root.y + ui.scale.height * 0.5, alpha: 0, duration: 380, ease: 'Back.easeIn', onComplete: () => f.root.destroy() });
  });
}

function endStar(scene: AmbleScene, won: boolean): void {
  const k = scene.__kit;
  if (!k || k.state !== (won ? 'won' : 'lost')) return;
  const key = k.hero?.key ?? starKey(k);
  if (!key) return;
  const ui = k.uiScene;
  // After the panel appears (win() waits 250 ms), so the hero stands in front of it.
  ui.time.delayedCall(won ? 300 : 80, () => {
    if (k.dead) return;
    const f = figure(ui, k, key, ui.scale.width / 2, ui.scale.height - 46, Math.min(140, ui.scale.height * 0.26));
    // The rig's knock-out move fades away at its end: stop while the hero is lying down.
    perform(k, f, won ? 'cheer' : 'die', won ? { loop: true } : { loop: false, freezeMs: 820 });
  });
}

let installed = false;

export function installArtEverywhere(): void {
  if (installed) return;
  installed = true;
  const uiProto = Ui.prototype as unknown as { hearts(obj: { key?: string }): HeartsBar };
  const hearts = uiProto.hearts;
  uiProto.hearts = function (this: Ui, obj: { key?: string }) {
    const bar = hearts.call(this, obj);
    if (typeof obj.key === 'string') useHeads(this, bar, obj.key);
    return bar;
  };
  const sceneProto = AmbleScene.prototype as unknown as { afterCreate(): void; win(text?: string): void; lose(text?: string): void };
  const afterCreate = sceneProto.afterCreate;
  sceneProto.afterCreate = function (this: AmbleScene) {
    afterCreate.call(this);
    titleStar(this);
  };
  const win = sceneProto.win;
  sceneProto.win = function (this: AmbleScene, text?: string) {
    const before = this.__kit?.state;
    win.call(this, text);
    if (before === 'play') endStar(this, true);
  };
  const lose = sceneProto.lose;
  sceneProto.lose = function (this: AmbleScene, text?: string) {
    const before = this.__kit?.state;
    lose.call(this, text);
    if (before === 'play') endStar(this, false);
  };
}
