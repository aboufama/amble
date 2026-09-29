/**
 * The HUD, drawn by a separate real-time scene on top of the game: never shaken, zoomed, slowed or
 * post-processed, so it stays readable during chaos. Everything important it shows is also posted to the
 * editor as a game event, which feeds the screen-reader text mirror.
 */
import Phaser from 'phaser';
import { colorInt, cssColor, hsl } from './color';
import { env } from './env';
import type { Kit } from './state';
import type { Point } from './types';
import { util } from './util';

export const UI_SCENE = '__amble_ui';
export const FONT = '"Amble Game", "Lilita One", "Arial Rounded MT Bold", "Arial Black", system-ui, sans-serif';
const INK = '#17132b';

/** The always-on UI scene. */
export class UiScene extends Phaser.Scene {
  constructor() {
    super({ key: UI_SCENE, active: true });
  }

  create(): void {
    this.scene.bringToTop();
  }
}

function textStyle(size: number, color = '#ffffff', stroke = 6): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${size}px`, color, stroke: INK, strokeThickness: stroke, fontStyle: 'bold' };
}

interface HealthLike {
  hp: number;
  maxHp: number;
  alive: boolean;
  active: boolean;
}

interface BossBar {
  kind: 'boss';
  obj: HealthLike;
  w: number;
  x: number;
  fill: Phaser.GameObjects.Rectangle;
  trail: Phaser.GameObjects.Rectangle;
  shine: Phaser.GameObjects.Rectangle;
  /** The frame and the name under the bar. */
  extras: Phaser.GameObjects.GameObject[];
  shown: number;
  trailV: number;
  ticks: Phaser.GameObjects.Rectangle[];
}

interface Hearts {
  kind: 'hearts';
  obj: HealthLike;
  icons: Phaser.GameObjects.Image[];
  last: number;
}

interface SmallBar {
  kind: 'small';
  obj: HealthLike & Point & { displayHeight?: number };
  w: number;
  bg: Phaser.GameObjects.Rectangle;
  fill: Phaser.GameObjects.Rectangle;
}

type Bar = BossBar | Hearts | SmallBar;

export class Ui {
  readonly s: Phaser.Scene;
  readonly W: number;
  readonly H: number;
  private readonly bars: Bar[] = [];
  private bigs: Phaser.GameObjects.Text[] = [];
  private scoreText: Phaser.GameObjects.Text | null = null;
  private readonly overlay: Phaser.GameObjects.Rectangle;
  private readonly panels = new Map<string, Phaser.GameObjects.GameObject[]>();
  private readonly followers: Array<{ target: Point & { active?: boolean }; obj: Phaser.GameObjects.Container; dy: number }> = [];
  private lastScorePost = 0;
  private scoreTimer: Phaser.Time.TimerEvent | null = null;

  constructor(private readonly k: Kit) {
    this.s = k.uiScene;
    this.W = this.s.scale.width;
    this.H = this.s.scale.height;
    this.overlay = this.s.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0xffffff, 1).setVisible(false).setDepth(9000);
  }

  private mirror(text: string): void {
    const t = text.trim();
    if (t) env().post({ type: 'event', event: { kind: 'text', text: t.slice(0, 300) } });
  }

  /** A full-screen flash (fx.flash already went through the limiter). */
  flashOverlay(color: number, alpha: number, ms: number): void {
    const r = this.overlay;
    r.setFillStyle(color, 1).setAlpha(alpha).setVisible(true);
    this.s.tweens.killTweensOf(r);
    this.s.tweens.add({ targets: r, alpha: 0, duration: ms, ease: 'Quad.easeOut', onComplete: () => r.setVisible(false) });
  }

  text(x: number, y: number, str: string, o: { size?: number; color?: unknown; stroke?: number; originX?: number; originY?: number } = {}): Phaser.GameObjects.Text {
    return this.s.add
      .text(x, y, String(str), textStyle(o.size ?? 22, cssColor(o.color ?? '#ffffff'), o.stroke ?? 6))
      .setOrigin(o.originX ?? 0.5, o.originY ?? 0.5)
      .setDepth(8000);
  }

  /** A big centre title ("PHASE 2!", "WAVE 3", "GO!"); a new one pushes the previous one out. */
  big(str: string, o: { sub?: string; color?: unknown; size?: number; ms?: number; y?: number } = {}): Phaser.GameObjects.Text {
    for (const old of this.bigs) {
      if (!old.active) continue;
      this.s.tweens.killTweensOf(old);
      this.s.tweens.add({ targets: old, alpha: 0, y: old.y - 40, duration: 150, onComplete: () => old.destroy() });
    }
    const y = this.H * (o.y ?? 0.38);
    const t = this.text(this.W / 2, y, str, { size: o.size ?? 76, color: o.color ?? '#ffe45e', stroke: 12 }).setScale(0).setAngle(-8);
    t.setShadow(0, 6, 'rgba(0,0,0,0.45)', 0, true, true);
    const sub = o.sub ? this.text(this.W / 2, y + 62, o.sub, { size: 26 }).setAlpha(0) : null;
    const motion = env().prefs.reducedMotion;
    this.s.tweens.add({ targets: t, scale: 1, angle: motion ? 0 : util.rand(-4, 4), duration: motion ? 1 : 380, ease: 'Back.easeOut' });
    if (sub) this.s.tweens.add({ targets: sub, alpha: 1, delay: 200, duration: 250 });
    this.bigs = sub ? [t, sub] : [t];
    if (o.ms !== 0) {
      this.s.time.delayedCall(o.ms ?? 1300, () => {
        this.s.tweens.add({ targets: this.bigs.filter((b) => b === t || b === sub), alpha: 0, scale: 1.4, duration: 300, onComplete: () => { t.destroy(); sub?.destroy(); } });
      });
    }
    this.mirror(o.sub ? `${str}. ${o.sub}` : str);
    return t;
  }

  /** Floating world text (+100, damage numbers). */
  pop(x: number, y: number, str: string | number, o: { color?: unknown; size?: number; rise?: number; ms?: number } = {}): Phaser.GameObjects.Text {
    const g = this.k.scene;
    const t = g.add.text(x, y, String(str), textStyle(o.size ?? 22, cssColor(o.color ?? '#ffffff'), 5)).setOrigin(0.5).setDepth(880).setScale(0.4);
    g.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.easeOut' });
    g.tweens.add({ targets: t, y: y - (o.rise ?? 46), alpha: 0, delay: 160, duration: o.ms ?? 650, ease: 'Cubic.easeIn', onComplete: () => t.destroy() });
    return t;
  }

  /** A hint line at the bottom of the screen. */
  hint(str: string, ms = 5000): Phaser.GameObjects.Text {
    const t = this.text(this.W / 2, this.H - 26, str, { size: 18, stroke: 5 }).setAlpha(0.9);
    this.s.time.delayedCall(ms, () => this.s.tweens.add({ targets: t, alpha: 0, duration: 600, onComplete: () => t.destroy() }));
    this.mirror(str);
    return t;
  }

  score(): Phaser.GameObjects.Text {
    this.scoreText ??= this.text(this.W - 20, 22, 'SCORE 0', { size: 26, originX: 1, originY: 0 });
    return this.scoreText;
  }

  setScore(v: number): void {
    const t = this.score();
    t.setText('SCORE ' + v);
    this.s.tweens.killTweensOf(t);
    t.setScale(1.25);
    this.s.tweens.add({ targets: t, scale: 1, duration: 180, ease: 'Back.easeOut' });
    // At most a few score events a second (the editor's live region reads them out).
    const now = env().now();
    const post = () => {
      this.lastScorePost = env().now();
      this.scoreTimer = null;
      env().post({ type: 'event', event: { kind: 'score', value: this.k.score } });
    };
    if (now - this.lastScorePost > 250) post();
    else this.scoreTimer ??= this.s.time.delayedCall(250, post);
  }

  /** A wide boss health bar at the top, with a lagging damage trail. */
  bossBar(obj: HealthLike, name = 'BOSS', o: { color?: unknown; width?: number; height?: number; y?: number } = {}): BossBar {
    const w = o.width ?? this.W * 0.56;
    const h = o.height ?? 18;
    const x = (this.W - w) / 2;
    const y = o.y ?? 34;
    const frame = this.s.add.rectangle(x - 4, y - 4, w + 8, h + 8, 0x1d1233).setOrigin(0).setDepth(7000);
    const trail = this.s.add.rectangle(x, y, w, h, 0xffffff).setOrigin(0).setDepth(7001);
    const fill = this.s.add.rectangle(x, y, w, h, colorInt(o.color ?? 0xff4d6d)).setOrigin(0).setDepth(7002);
    const shine = this.s.add.rectangle(x, y + 2, w, h * 0.3, 0xffffff, 0.3).setOrigin(0).setDepth(7003);
    const label = this.s.add.text(this.W / 2, y + h + 16, name, textStyle(20)).setOrigin(0.5).setDepth(7004);
    const bar: BossBar = { kind: 'boss', obj, w, x, fill, trail, shine, extras: [frame, label], shown: 1, trailV: 1, ticks: [] };
    this.bars.push(bar);
    this.mirror(name);
    return bar;
  }

  /** A boss bar that can be taken down again (twists that bring their own boss). */
  removableBossBar(obj: HealthLike, name = 'BOSS'): () => void {
    const bar = this.bossBar(obj, name);
    return () => {
      const i = this.bars.indexOf(bar);
      if (i >= 0) this.bars.splice(i, 1);
      for (const o of [bar.fill, bar.trail, bar.shine, ...bar.extras, ...bar.ticks]) o.destroy();
    };
  }

  /** Marks phase thresholds on a boss bar. */
  addTicks(obj: HealthLike, ratios: number[]): void {
    const bar = this.bars.find((b): b is BossBar => b.kind === 'boss' && b.obj === obj);
    if (!bar) return;
    for (const r of ratios) bar.ticks.push(this.s.add.rectangle(bar.x + bar.w * r, bar.fill.y, 3, bar.fill.height, 0x1d1233).setOrigin(0.5, 0).setDepth(7005));
  }

  /** Hearts for the hero's hit points (top left). */
  hearts(obj: HealthLike): Hearts {
    const icons = Array.from({ length: Math.min(12, obj.maxHp || 3) }, (_, i) => this.s.add.image(26 + i * 30, 28, 'amble-fx', 'heart').setScale(1.15).setDepth(7000));
    const bar: Hearts = { kind: 'hearts', obj, icons, last: obj.hp };
    this.bars.push(bar);
    env().post({ type: 'event', event: { kind: 'lives', value: obj.hp, max: obj.maxHp } });
    return bar;
  }

  /** A small health bar that follows an enemy. */
  bar(obj: HealthLike & Point & { displayHeight?: number }, o: { width?: number; color?: unknown } = {}): SmallBar {
    const w = o.width ?? 40;
    const bg = this.k.scene.add.rectangle(obj.x, obj.y, w + 4, 7, 0x1d1233).setDepth(870);
    const fill = this.k.scene.add.rectangle(obj.x - w / 2, obj.y, w, 4, colorInt(o.color ?? 0x7ddf8c)).setOrigin(0, 0.5).setDepth(871);
    const bar: SmallBar = { kind: 'small', obj, w, bg, fill };
    this.bars.push(bar);
    return bar;
  }

  /** A speech bubble over something (kept on screen). */
  say(obj: Point & { active?: boolean }, str: string, ms = 2400): void {
    const pad = 10;
    const t = this.s.add.text(0, 0, String(str), { fontFamily: FONT, fontSize: '18px', color: '#1d1233', wordWrap: { width: 260 } }).setOrigin(0.5);
    const bg = this.s.add.graphics();
    const w = t.width + pad * 2;
    const h = t.height + pad * 2;
    bg.fillStyle(0xfbf6ec, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 12).lineStyle(3, 0x1d1233, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
    bg.fillStyle(0xfbf6ec, 1).fillTriangle(-8, h / 2 - 1, 8, h / 2 - 1, 0, h / 2 + 10);
    const c = this.s.add.container(0, 0, [bg, t]).setDepth(7600);
    this.followers.push({ target: obj, obj: c, dy: 40 + h / 2 });
    this.s.time.delayedCall(ms, () => this.s.tweens.add({ targets: c, alpha: 0, duration: 250, onComplete: () => c.destroy() }));
    this.mirror(str);
  }

  /** A typewriter dialogue box; Space, Enter or a tap shows the next line. Resolves at the end. */
  dialogue(lines: Array<string | { who?: string; text: string }>): Promise<void> {
    const list = lines.map((l) => (typeof l === 'string' ? { who: '', text: l } : { who: l.who ?? '', text: String(l.text ?? '') }));
    const W = this.W;
    const box = this.s.add.rectangle(W / 2, this.H - 80, W - 60, 110, 0x17132b, 0.92).setStrokeStyle(3, 0xf5f0e6, 0.7).setDepth(7700);
    const who = this.s.add.text(50, this.H - 128, '', textStyle(20, '#ffd23f', 4)).setDepth(7701);
    const body = this.s.add.text(50, this.H - 100, '', { fontFamily: FONT, fontSize: '20px', color: '#f5f0e6', wordWrap: { width: W - 100 } }).setDepth(7701);
    const more = this.s.add.text(W - 48, this.H - 40, '▶', textStyle(18, '#43e6b0', 3)).setOrigin(1).setDepth(7701);
    let i = 0;
    let shown = 0;
    let timer: Phaser.Time.TimerEvent | null = null;
    return new Promise<void>((resolve) => {
      const show = () => {
        const line = list[i];
        who.setText(line.who);
        shown = 0;
        body.setText('');
        this.mirror(line.who ? `${line.who}: ${line.text}` : line.text);
        timer?.remove();
        timer = this.s.time.addEvent({ delay: 28, repeat: Math.max(0, line.text.length - 1), callback: () => body.setText(line.text.slice(0, ++shown)) });
      };
      const next = () => {
        const line = list[i];
        if (line && shown < line.text.length) {
          shown = line.text.length;
          timer?.remove();
          body.setText(line.text);
          return;
        }
        i++;
        if (i >= list.length) {
          cleanup();
          resolve();
        } else show();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.code === 'Space' || e.code === 'Enter') next();
      };
      const cleanup = () => {
        window.removeEventListener('keydown', onKey);
        this.k.scene.input.off('pointerdown', next);
        timer?.remove();
        for (const o of [box, who, body, more]) o.destroy();
      };
      window.addEventListener('keydown', onKey);
      this.k.scene.input.on('pointerdown', next);
      this.k.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
      if (list.length) show();
      else {
        cleanup();
        resolve();
      }
    });
  }

  /** A button in the HUD. */
  button(x: number, y: number, label: string, onClick: () => void): Phaser.GameObjects.Container {
    const t = this.s.add.text(0, 0, label, textStyle(22, '#1a0f0a', 0)).setOrigin(0.5);
    const w = Math.max(90, t.width + 36);
    const bg = this.s.add.rectangle(0, 0, w, 48, 0xff6b4a).setStrokeStyle(3, 0x1a0f0a, 0.6);
    const c = this.s.add.container(x, y, [bg, t]).setDepth(7800).setSize(w, 48).setInteractive({ useHandCursor: true });
    c.on('pointerdown', () => {
      c.setScale(0.95);
      this.k.guard(onClick);
    });
    c.on('pointerup', () => c.setScale(1));
    c.on('pointerout', () => c.setScale(1));
    return c;
  }

  /** A countdown at the top; calls onDone at zero. */
  timer(seconds: number, onDone?: () => void): { left: number; stop(): void } {
    const t = this.text(this.W / 2, 70, '', { size: 34 });
    const state = { left: Math.max(0, seconds), stopped: false, stop: () => { state.stopped = true; t.destroy(); } };
    const fn = (dt: number) => {
      if (state.stopped) return;
      state.left = Math.max(0, state.left - dt);
      t.setText(String(Math.ceil(state.left)));
      if (state.left <= 0) {
        state.stop();
        this.k.postFns.splice(this.k.postFns.indexOf(fn), 1);
        if (onDone) this.k.guard(onDone);
      }
    };
    this.k.postFns.push(fn);
    return state;
  }

  /** A full-screen panel of centred lines (title card, pause, win/lose). */
  panel(lines: Array<[string, number?, string?]>, o: { top?: number; gap?: number; alpha?: number; name?: string } = {}): Phaser.GameObjects.GameObject[] {
    const objs: Phaser.GameObjects.GameObject[] = [this.s.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x0b0618, o.alpha ?? 0.72).setDepth(9500)];
    lines.forEach(([str, size = 32, color = '#ffffff'], i) => {
      if (!str) return;
      objs.push(this.s.add.text(this.W / 2, this.H * (o.top ?? 0.32) + i * (o.gap ?? 70), str, textStyle(size, color, size > 40 ? 12 : 6)).setOrigin(0.5).setDepth(9501));
    });
    if (o.name) {
      this.clearPanel(o.name);
      this.panels.set(o.name, objs);
    }
    return objs;
  }

  clearPanel(name: string): void {
    this.panels.get(name)?.forEach((g) => g.destroy());
    this.panels.delete(name);
  }

  /** Per-frame upkeep: bars follow hit points, bubbles follow their speakers. */
  tick(): void {
    const cam = this.k.scene.cameras.main;
    for (const b of this.bars) {
      const o = b.obj;
      if (b.kind === 'hearts') {
        if (o.hp !== b.last) {
          b.icons.forEach((icon, i) => {
            const full = i < o.hp;
            if (!full && icon.alpha === 1) this.s.tweens.add({ targets: icon, scale: 2, alpha: 0.2, duration: 300, onComplete: () => icon.setScale(0.9) });
            else if (full) {
              // A heal right after a hit: stop the fading first, or it finishes over the full heart and dims it.
              this.s.tweens.killTweensOf(icon);
              icon.setAlpha(1).setScale(1.15);
            }
          });
          b.last = o.hp;
          env().post({ type: 'event', event: { kind: 'lives', value: Math.max(0, o.hp), max: o.maxHp } });
        }
        continue;
      }
      const ratio = o.maxHp ? util.clamp(o.hp / o.maxHp, 0, 1) : 0;
      if (b.kind === 'small') {
        const alive = o.active && o.alive;
        b.bg.setVisible(alive).setPosition(b.obj.x, b.obj.y - (b.obj.displayHeight ?? 40) / 2 - 10);
        b.fill.setVisible(alive).setPosition(b.obj.x - b.w / 2, b.bg.y);
        b.fill.width = b.w * ratio;
        continue;
      }
      b.shown = util.lerp(b.shown, ratio, 0.35);
      b.trailV = b.trailV > b.shown ? Math.max(b.shown, b.trailV - 0.004) : b.shown;
      b.fill.width = b.w * b.shown;
      b.trail.width = b.w * b.trailV;
      b.shine.width = b.w * b.shown;
      if (!o.alive || !o.active) b.fill.width = 0;
    }
    for (let i = this.followers.length - 1; i >= 0; i--) {
      const f = this.followers[i];
      if (!f.obj.active || f.target.active === false) {
        this.followers.splice(i, 1);
        continue;
      }
      const sx = (f.target.x - cam.worldView.x) * cam.zoom;
      const sy = (f.target.y - cam.worldView.y) * cam.zoom - f.dy;
      const halfW = (f.obj.getBounds().width || 100) / 2;
      f.obj.setPosition(util.clamp(sx, halfW + 6, this.W - halfW - 6), util.clamp(sy, 40, this.H - 40));
    }
  }

  /** The escalating combo counter text. */
  comboText(count: number): void {
    const t = this.panels.get('combo')?.[0] as Phaser.GameObjects.Text | undefined;
    const text = t ?? this.text(this.W / 2, 92, '', { size: 34 });
    if (!t) this.panels.set('combo', [text]);
    const color = Phaser.Display.Color.IntegerToColor(hsl((count * 37) % 360, 0.9, 0.65)).rgba;
    text.setText(`COMBO x${count}`).setColor(color).setAlpha(1);
    this.s.tweens.killTweensOf(text);
    text.setScale(1.5).setAngle(env().prefs.reducedMotion ? 0 : util.rand(-8, 8));
    this.s.tweens.add({ targets: text, scale: 1, angle: 0, duration: 220, ease: 'Back.easeOut' });
  }

  comboEnd(): void {
    const t = this.panels.get('combo')?.[0];
    if (t) this.s.tweens.add({ targets: t, alpha: 0, duration: 300 });
  }

  /** The scene restarts: clear everything this scene put in the HUD. */
  shutdown(): void {
    const u = this.s;
    if (u.sys?.isActive()) {
      u.tweens.killAll();
      u.time.removeAllEvents();
      u.children.list.slice().forEach((c) => c.destroy());
    }
    this.panels.clear();
  }
}
