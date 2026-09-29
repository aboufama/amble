/**
 * Stand-ins while the editor has the game paused: every one shows its name tag, and tapping one tells the
 * editor which drawing it stands for (`artClicked`), so the student can go and draw it. While paused, taps
 * never reach the game (Phaser handles input events even when its loop sleeps).
 */
import Phaser from 'phaser';
import type { FromPlayer, Rect } from '../../play/protocol';
import { HD, registryFor, type ArtRegistry } from '../kit/art';
import { Character } from '../kit/character';
import { UI_SCENE } from '../kit/ui';

type Bounded = Phaser.GameObjects.GameObject & { getBounds(out?: Phaser.Geom.Rectangle): Phaser.Geom.Rectangle; visible?: boolean; depth?: number };

const POINTER_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click'] as const;

function gameScenes(game: Phaser.Game): Phaser.Scene[] {
  return game.scene.getScenes(true).filter((s) => s.sys.settings.key !== UI_SCENE);
}

function* walk(list: Phaser.GameObjects.GameObject[]): Generator<Phaser.GameObjects.GameObject> {
  for (const o of list) {
    yield o;
    if (o instanceof Phaser.GameObjects.Container && !(o instanceof Character)) yield* walk(o.list);
  }
}

/** The art key a display object shows, if it is a stand-in for the student's drawing. */
function ghostKey(o: Phaser.GameObjects.GameObject, reg: ArtRegistry): string | null {
  let key: string | null = null;
  if (o instanceof Character) key = o.key;
  else {
    const tex = (o as { texture?: Phaser.Textures.Texture }).texture;
    if (tex?.key) key = tex.key.endsWith(HD) ? tex.key.slice(0, -HD.length) : tex.key;
  }
  if (!key || key.startsWith('~') || key.startsWith('__')) return null;
  return reg.isUsed(key) && !reg.isDrawn(key) ? key : null;
}

export class GhostTaps {
  private paused = false;

  constructor(
    private readonly post: (msg: FromPlayer) => void,
    private readonly game: () => Phaser.Game | null,
    private readonly enabled: () => boolean,
  ) {
    for (const type of POINTER_EVENTS) window.addEventListener(type, (e) => this.onEvent(e), { capture: true });
  }

  /** Shows or hides every stand-in's tag (the loop is asleep while paused, so the caller renders a frame). */
  setPaused(on: boolean): void {
    this.paused = on;
    const game = this.game();
    if (!game) return;
    for (const scene of gameScenes(game)) {
      for (const o of walk(scene.children.list)) if (o instanceof Character) o.forceTag(on);
    }
  }

  private onEvent(e: Event): void {
    if (!this.paused) return;
    e.stopPropagation();
    if (e.type !== 'pointerdown' || !this.enabled()) return;
    const game = this.game();
    const p = e as PointerEvent;
    if (!game) return;
    const hit = this.hitTest(game, p.clientX, p.clientY);
    if (hit) this.post({ type: 'artClicked', key: hit.key, rect: hit.rect });
  }

  private hitTest(game: Phaser.Game, clientX: number, clientY: number): { key: string; rect: Rect } | null {
    const reg = registryFor(game);
    if (!reg) return null;
    const box = game.canvas.getBoundingClientRect();
    const sx = box.width / game.scale.width || 1;
    const sy = box.height / game.scale.height || 1;
    const gx = (clientX - box.left) / sx;
    const gy = (clientY - box.top) / sy;
    for (const scene of gameScenes(game).reverse()) {
      const cam = scene.cameras.main;
      const world = cam.getWorldPoint(gx, gy);
      const list = [...walk(scene.children.list)].filter((o): o is Bounded => typeof (o as Bounded).getBounds === 'function');
      list.sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));
      for (const o of list) {
        if (!o.active || o.visible === false) continue;
        const key = ghostKey(o, reg);
        if (!key) continue;
        const r = o.getBounds();
        if (!r.contains(world.x, world.y)) continue;
        const left = (r.x - cam.worldView.x) * cam.zoom + cam.x;
        const top = (r.y - cam.worldView.y) * cam.zoom + cam.y;
        return { key, rect: { x: box.left + left * sx, y: box.top + top * sy, w: r.width * cam.zoom * sx, h: r.height * cam.zoom * sy } };
      }
    }
    return null;
  }
}
