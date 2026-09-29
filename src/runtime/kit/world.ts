/**
 * The world around the action: parallax scenery, weather, levels from ASCII maps, platforms, endless
 * procedural chunks, the camera, and portals. Kit scenery (stars, hills...) is plain and procedural; any
 * layer or tile that names an art key uses the student's drawing (or its stand-in).
 */
import Phaser from 'phaser';
import { colorInt, cssColor } from './color';
import { env } from './env';
import type { Kit } from './state';
import type { AmbleScene, SpawnOptions } from './scene';
import { arcadeBody, type Point } from './types';
import { seeded, TAU, util } from './util';
import { EDGE_HEIGHT } from './ghost/paint';

export interface ParallaxLayer {
  draw?: 'stars' | 'mountains' | 'hills' | 'clouds' | 'city';
  key?: string;
  color?: unknown;
  factor?: number;
  y?: number;
  height?: number;
  speed?: number;
  depth?: number;
  seed?: number;
}

export type LegendEntry = string | ({ key: string; solid?: boolean; oneWay?: boolean; height?: number; depth?: number } & SpawnOptions) | ((x: number, y: number) => void);

const INK = '#1d1233';

function layerTexture(scene: Phaser.Scene, kind: string, color: number, w: number, h: number, seed: number): string {
  const key = `~layer:${kind}:${color}:${w}x${h}:${seed}`;
  const tm = scene.sys.textures;
  if (tm.exists(key)) return key;
  const tex = tm.createCanvas(key, w, h);
  if (!tex) return '__WHITE';
  const ctx = tex.context;
  const r = seeded(seed);
  const col = cssColor(color);
  if (kind === 'stars') {
    for (let i = 0; i < (w * h) / 900; i++) {
      ctx.globalAlpha = 0.3 + r() * 0.7;
      ctx.fillStyle = r() < 0.2 ? '#ffe9a8' : '#ffffff';
      const s = r() < 0.08 ? 2.5 : r() < 0.4 ? 1.5 : 1;
      ctx.fillRect(r() * w, r() * h, s, s);
    }
  } else if (kind === 'clouds') {
    ctx.fillStyle = col;
    for (let i = 0; i < 5; i++) {
      const cx = (i + 0.2 + r() * 0.6) * (w / 5);
      const cy = h * (0.3 + r() * 0.4);
      for (let j = 0; j < 5; j++) {
        ctx.beginPath();
        ctx.ellipse(cx + (j - 2) * 22, cy + Math.abs(j - 2) * 6, 34 - Math.abs(j - 2) * 6, 22, 0, 0, TAU);
        ctx.fill();
      }
    }
  } else if (kind === 'city') {
    ctx.fillStyle = col;
    let x = 0;
    while (x < w) {
      const bw = 30 + r() * 50;
      const bh = h * (0.25 + r() * 0.6);
      ctx.fillRect(x, h - bh, bw - 4, bh);
      ctx.save();
      ctx.fillStyle = 'rgba(255,230,150,0.35)';
      for (let yy = h - bh + 8; yy < h - 8; yy += 14) for (let xx = x + 6; xx < x + bw - 12; xx += 12) if (r() < 0.4) ctx.fillRect(xx, yy, 5, 7);
      ctx.restore();
      x += bw;
    }
  } else {
    const ks: Array<[number, number]> = kind === 'mountains' ? [[1, 0.28], [3, 0.12], [7, 0.05], [13, 0.025]] : [[1, 0.12], [2, 0.08], [5, 0.03]];
    const phase = ks.map(() => r() * TAU);
    const ridge = (x: number) => h * (kind === 'mountains' ? 0.45 : 0.4) - ks.reduce((s, [f, a], i) => s + Math.sin((x / w) * TAU * f + phase[i]) * a * h, 0);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) ctx.lineTo(x, ridge(x));
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) ctx.lineTo(x, ridge(x));
    ctx.stroke();
    ctx.globalAlpha = kind === 'mountains' ? 0.16 : 0.1;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) ctx.lineTo(x, ridge(x) + 6);
    ctx.stroke();
  }
  tex.refresh();
  return key;
}

type ParallaxSprite = Phaser.GameObjects.TileSprite & { factor: number; speed: number; drift: number };

/** Parallax layers (at most 5 full-screen layers: each one costs a full-screen fill on weak GPUs). */
export function parallax(scene: AmbleScene, k: Kit, layers: ParallaxLayer[]): Phaser.GameObjects.TileSprite[] {
  const W = scene.scale.width;
  const H = scene.scale.height;
  const calm = env().prefs.reducedMotion;
  const out = layers.slice(0, 5).map((L, i) => {
    const h = L.height ?? (L.draw === 'stars' ? H : H * 0.5);
    let key: string;
    if (L.key) {
      k.art.use(L.key);
      key = k.art.hd(L.key);
    } else key = layerTexture(scene, L.draw ?? 'hills', colorInt(L.color, 0x2b1654), L.draw === 'stars' ? 512 : 1024, Math.ceil(h), (L.seed ?? i) + 11);
    const ts = scene.add.tileSprite(0, L.y ?? H - h, W, h, key).setOrigin(0).setScrollFactor(0).setDepth(L.depth ?? -100 + i) as ParallaxSprite;
    if (L.key) {
      const fr = scene.textures.getFrame(key);
      if (fr) ts.setTileScale(h / fr.height, h / fr.height);
    }
    ts.factor = (L.factor ?? 0.1 * (i + 1)) * (calm ? 0.35 : 1);
    ts.speed = calm ? 0 : L.speed ?? 0;
    ts.drift = 0;
    return ts;
  });
  k.postFns.push((dt) => {
    const cam = scene.cameras.main;
    for (const ts of out) {
      ts.drift += ts.speed * dt;
      ts.tilePositionX = cam.scrollX * ts.factor + ts.drift;
    }
  });
  return out;
}

/** Screen-space weather: 'rain' | 'snow' | 'embers' | 'bubbles'. */
export function weather(scene: AmbleScene, k: Kit, kind: string, o: { amount?: number; depth?: number; config?: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig } = {}): Phaser.GameObjects.Particles.ParticleEmitter | null {
  const W = scene.scale.width;
  const H = scene.scale.height;
  const q = k.webgl ? 1 : 0.5;
  const amt = Math.max(0.1, (o.amount ?? 1) * q * (env().prefs.reducedMotion ? 0.5 : 1));
  const configs: Record<string, Phaser.Types.GameObjects.Particles.ParticleEmitterConfig> = {
    rain: { frame: 'spark', x: { min: -100, max: W + 100 }, y: -20, speedY: { min: 700, max: 950 }, speedX: -140, rotate: 99, lifespan: 900, frequency: 16 / amt, quantity: 2, scaleX: 0.9, scaleY: 0.35, alpha: 0.45, tint: 0xa8d8ff },
    snow: { frame: 'dot', x: { min: -50, max: W + 50 }, y: -10, speedY: { min: 30, max: 80 }, speedX: { min: -30, max: 30 }, lifespan: 9000, frequency: 90 / amt, quantity: 1, scale: { min: 0.12, max: 0.35 }, alpha: 0.85 },
    embers: { frame: 'dot', x: { min: 0, max: W }, y: H + 10, speedY: { min: -120, max: -40 }, speedX: { min: -20, max: 20 }, lifespan: 5000, frequency: 70 / amt, quantity: 1, scale: { start: 0.35, end: 0 }, tint: [0xff8c42, 0xffd23f], blendMode: 'ADD' },
    bubbles: { frame: 'ring', x: { min: 0, max: W }, y: H + 20, speedY: { min: -90, max: -40 }, speedX: { min: -15, max: 15 }, lifespan: 7000, frequency: 160 / amt, quantity: 1, scale: { min: 0.1, max: 0.3 }, alpha: 0.55 },
  };
  const cfg = configs[kind] ?? configs.rain;
  const e = scene.add.particles(0, 0, 'amble-fx', { ...cfg, ...o.config }).setScrollFactor(0).setDepth(o.depth ?? 800);
  return e;
}

/**
 * A terrain stand-in's dashed top edge: its own strip along the top of the platform (the bottom when the
 * platform is flipped), so tall platforms and stacked rows show one edge, not one per tile. It goes away
 * when the student draws the terrain.
 */
function ghostEdge(scene: AmbleScene, k: Kit, ts: Phaser.GameObjects.TileSprite, key: string): void {
  const reg = k.art;
  const tex = reg.edge(key);
  const fr = scene.sys.textures.getFrame(tex);
  const edge = scene.add.tileSprite(ts.x, ts.y, ts.width, EDGE_HEIGHT, tex).setDepth(ts.depth + 0.5);
  // The strip is painted at 2x like the tile; show it at its game size.
  if (fr) edge.setTileScale(EDGE_HEIGHT / fr.height, EDGE_HEIGHT / fr.height);
  const sync = () => {
    if (!ts.active) return;
    const down = ts.flipY;
    edge.setPosition(ts.x, ts.y + (down ? 1 : -1) * (ts.displayHeight / 2 - EDGE_HEIGHT / 2)).setFlipY(down).setVisible(ts.visible && !reg.isDrawn(key));
  };
  sync();
  k.postFns.push(sync);
  const unlisten = reg.listen({ key, artChanged: sync });
  ts.once(Phaser.GameObjects.Events.DESTROY, () => {
    unlisten();
    edge.destroy();
    const i = k.postFns.indexOf(sync);
    if (i >= 0) k.postFns.splice(i, 1);
  });
}

/** A solid platform (an Arcade static body) drawn by tiling a terrain drawing. */
export function platform(scene: AmbleScene, k: Kit, x: number, y: number, w: number, h = 32, key = 'ground', o: { oneWay?: boolean; depth?: number } = {}): Phaser.GameObjects.TileSprite {
  k.art.use(key);
  const spec = k.art.spec(key);
  const tex = k.art.hd(key);
  // Whole-pixel edges: neighbouring platforms placed at fractional positions would show hairline seams.
  const left = Math.round(x - w / 2);
  const top = Math.round(y - h / 2);
  const pw = Math.max(1, Math.round(x + w / 2) - left);
  const ph = Math.max(1, Math.round(y + h / 2) - top);
  const ts = scene.add.tileSprite(left + pw / 2, top + ph / 2, pw, ph, tex).setDepth(o.depth ?? 100);
  const fr = scene.sys.textures.getFrame(tex);
  // A drawn tile keeps its own shape at the art's height; stand-in tiles are painted at 2x.
  const tileH = Math.min(h, spec.h);
  if (fr) ts.setTileScale(tileH / fr.height, tileH / fr.height);
  if (spec.kind === 'terrain') ghostEdge(scene, k, ts, key);
  if (k.physicsType === 'arcade') {
    scene.physics.add.existing(ts, true);
    k.group('platforms', { static: true }).add(ts);
    const b = ts.body as Phaser.Physics.Arcade.StaticBody | null;
    if (o.oneWay && b) {
      b.checkCollision.down = false;
      b.checkCollision.left = false;
      b.checkCollision.right = false;
    }
  } else if (k.physicsType === 'matter') scene.matter.add.gameObject(ts, { isStatic: true });
  (ts as Phaser.GameObjects.TileSprite & { __ambleKey?: string }).__ambleKey = key;
  return ts;
}

interface Run {
  ch: string;
  c0: number;
  c1: number;
  r0: number;
  r1: number;
}

/**
 * Builds a level from rows of characters. Runs of solid tiles merge into single bodies, across rows too
 * (a two-row floor is one platform with one top edge).
 */
export function level(scene: AmbleScene, k: Kit, rows: string[], o: { tile?: number; legend?: Record<string, LegendEntry>; bounds?: boolean } = {}): { width: number; height: number; platforms: Phaser.Physics.Arcade.StaticGroup | Phaser.GameObjects.Group } {
  const T = Math.max(4, o.tile ?? 32);
  const legend: Record<string, LegendEntry> = { '#': 'ground', ...o.legend };
  const plats = k.group('platforms', { static: true });
  const entryOf = (def: LegendEntry): Exclude<LegendEntry, string | ((x: number, y: number) => void)> | null =>
    typeof def === 'function' ? null : typeof def === 'string' ? { key: def } : def;
  const runs: Run[] = [];
  let open: Run[] = [];
  rows.forEach((row, r) => {
    const next: Run[] = [];
    let c = 0;
    while (c < row.length) {
      const ch = row[c];
      const def = legend[ch];
      if (def === undefined || ch === ' ' || ch === '.') {
        c++;
        continue;
      }
      const x = c * T + T / 2;
      const y = r * T + T / 2;
      if (typeof def === 'function') {
        k.guard(() => def(x, y), def);
        c++;
        continue;
      }
      const d = entryOf(def);
      if (!d) {
        c++;
        continue;
      }
      const spec = k.art.spec(d.key);
      if (spec.kind === 'terrain' || d.solid) {
        let e = c;
        while (e < row.length && row[e] === ch) e++;
        // Only full-height tiles stack into one platform (thin one-way ledges stay separate).
        const stacks = d.height === undefined || d.height === T;
        const above = stacks ? open.find((u) => u.ch === ch && u.c0 === c && u.c1 === e && u.r1 === r - 1) : undefined;
        if (above) {
          above.r1 = r;
          next.push(above);
        } else {
          const run = { ch, c0: c, c1: e, r0: r, r1: r };
          runs.push(run);
          if (stacks) next.push(run);
        }
        c = e;
      } else {
        scene.spawn(x, y, d.key, d);
        c++;
      }
    }
    open = next;
  });
  for (const run of runs) {
    const d = entryOf(legend[run.ch]);
    if (!d) continue;
    const w = (run.c1 - run.c0) * T;
    const th = run.r1 > run.r0 ? (run.r1 - run.r0 + 1) * T : d.height ?? T;
    platform(scene, k, run.c0 * T + w / 2, run.r0 * T + th / 2, w, th, d.key, { oneWay: d.oneWay, depth: d.depth });
  }
  const W = Math.max(...rows.map((r) => r.length), 1) * T;
  const H = rows.length * T;
  if (o.bounds !== false) worldSize(scene, Math.max(W, scene.scale.width), Math.max(H, scene.scale.height));
  return { width: W, height: H, platforms: plats as Phaser.Physics.Arcade.StaticGroup };
}

export function worldSize(scene: AmbleScene, w: number, h: number): void {
  if (scene.physics?.world) scene.physics.world.setBounds(0, 0, w, h);
  if (scene.matter?.world) scene.matter.world.setBounds(0, 0, w, h);
  scene.cameras.main.setBounds(0, 0, w, h);
}

/** Endless procedural world: make(x0, index) builds each chunk; old chunks behind the camera are removed. */
export function chunks(scene: AmbleScene, k: Kit, o: { size?: number; start?: number; ahead?: number; make(x0: number, index: number): void }): { next: number; index: number } {
  const size = Math.max(64, o.size ?? scene.scale.width);
  const st = { next: o.start ?? 0, index: 0, list: [] as Array<{ x: number; objs: Phaser.GameObjects.GameObject[] }> };
  const fill = () => {
    const cam = scene.cameras.main;
    const right = cam.scrollX + cam.width;
    let guard = 0;
    while (st.next < right + size * (o.ahead ?? 1) && guard++ < 20) {
      const before = scene.children.list.length;
      const x0 = st.next;
      const i = st.index;
      k.guard(() => o.make(x0, i), o.make);
      st.list.push({ x: x0, objs: scene.children.list.slice(before) });
      st.next += size;
      st.index++;
    }
    while (st.list.length && st.list[0].x + size < cam.scrollX - size * 0.5) {
      const chunk = st.list.shift();
      for (const obj of chunk?.objs ?? []) {
        const keep = (obj as { keep?: boolean }).keep;
        if (obj.active && !keep && obj !== (k.hero as unknown)) obj.destroy();
      }
    }
  };
  k.postFns.push(fill);
  fill();
  return st;
}

/** Camera follow. lockY keeps the view level (startFollow alone snaps it to the target's y). */
export function follow(scene: AmbleScene, k: Kit, obj: Point, o: { lerp?: number; lerpY?: number; lockY?: boolean | number; offsetX?: number; offsetY?: number; deadzone?: [number, number]; lookahead?: number } = {}): Phaser.Cameras.Scene2D.Camera {
  const cam = scene.cameras.main;
  const lock = o.lockY !== undefined && o.lockY !== false;
  cam.startFollow(obj, true, o.lerp ?? 0.12, lock ? 0 : o.lerpY ?? o.lerp ?? 0.12, o.offsetX ?? 0, o.offsetY ?? 0);
  if (lock) cam.scrollY = typeof o.lockY === 'number' ? o.lockY : 0;
  if (o.deadzone) cam.setDeadzone(o.deadzone[0], o.deadzone[1]);
  const ahead = o.lookahead;
  if (ahead) {
    k.postFns.push(() => {
      const facing = (obj as { facing?: number }).facing ?? 1;
      cam.followOffset.x = util.lerp(cam.followOffset.x, -facing * ahead, 0.04);
    });
  }
  return cam;
}

/** Two portals: touching one sends the hero (or anything with a body) to the other. */
export function portal(scene: AmbleScene, k: Kit, a: Point, b: Point, o: { color?: unknown; key?: string } = {}): void {
  const color = colorInt(o.color ?? 0xb69cff);
  const make = (p: Point) => {
    const img = o.key ? scene.spawn(p.x, p.y, o.key, { role: 'prop', gravity: false, body: false }) : scene.add.image(p.x, p.y, 'amble-fx', 'ring').setTint(color).setScale(1.6).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({ targets: img, angle: 360, duration: 3000, repeat: -1 });
    return img;
  };
  make(a);
  make(b);
  const radius = 34;
  let cooldownUntil = 0;
  k.postFns.push(() => {
    if (k.clock < cooldownUntil) return;
    for (const obj of [...k.living, ...(k.hero ? [k.hero] : [])]) {
      if (!obj.active) continue;
      const from = util.dist(obj, a) < radius ? a : util.dist(obj, b) < radius ? b : null;
      if (!from) continue;
      const to = from === a ? b : a;
      const body = arcadeBody(obj);
      if (body) body.reset(to.x, to.y);
      else obj.setPosition(to.x, to.y);
      k.fx.burst(from.x, from.y, { colors: [color, 0xffffff], count: 12, speed: [60, 220], life: 380 });
      k.fx.burst(to.x, to.y, { colors: [color, 0xffffff], count: 12, speed: [60, 220], life: 380 });
      scene.sfx('zap');
      cooldownUntil = k.clock + 600;
      break;
    }
  });
}
