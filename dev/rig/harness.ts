/**
 * Rig harness (browser): contact sheets of every move of every sample drawing rendered by the Phaser
 * adapter, a live platformer with every sample, a 20-character performance run, the Canvas 2D
 * previews and the worker. Pages set `window.__rig` when done (for dev/rig/shoot.mjs and e2e).
 *   ?mode=sheet&sample=hero[&frames=8&cell=110&clips=walk,run&canvas=1]
 *   ?mode=live   ?mode=perf&n=20   ?mode=preview   ?mode=worker   ?mode=editing
 */
import Phaser from 'phaser';
import { autoRig } from '../../src/rig/autorig';
import { bindRig } from '../../src/rig/bind';
import { clipsFor, resolveClip } from '../../src/rig/clips/library';
import { addDynamic, mirrorSides, moveJoint } from '../../src/rig/editing';
import { createRiggedMesh, type RiggedMesh } from '../../src/rig/phaser';
import { drawBones, restBonePoints } from '../../src/rig/render/bones';
import { drawRigged } from '../../src/rig/render/canvas';
import { renderContactSheet, sampleClip, unionBounds } from '../../src/rig/render/frames';
import { createRigPreview } from '../../src/rig/render/preview';
import { SAMPLES, type SampleDef, type SampleDrawing } from '../../src/rig/samples/kid-art';
import { templateFor } from '../../src/rig/templates';
import type { BoundRig, Pixels, RigData } from '../../src/rig/types';
import { createRigWorker } from '../../src/rig/worker/client';

declare global {
  interface Window {
    __rig?: Record<string, unknown>;
  }
}

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'menu';
const out = document.getElementById('out')!;
const stage = document.getElementById('stage')!;
const log = (s: string) => {
  out.textContent += `${s}\n`;
};
const done = (info: Record<string, unknown> = {}) => {
  window.__rig = { ready: true, ...info };
};

interface Loaded {
  def: SampleDef;
  s: SampleDrawing;
  rig: RigData;
  bound: BoundRig;
  image: HTMLCanvasElement;
  layers: Record<string, HTMLCanvasElement>;
  rigMs: number;
  bindMs: number;
}

function toCanvas(p: Pixels): HTMLCanvasElement {
  const c = Object.assign(document.createElement('canvas'), { width: p.width, height: p.height });
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  return c;
}

function load(name: string): Loaded {
  const def = SAMPLES.find((d) => d.name === name) ?? SAMPLES[0];
  const s = def.draw();
  const t0 = performance.now();
  const r = autoRig(s, s.kind);
  const t1 = performance.now();
  const bound = bindRig(s, r.rig, { analysis: r.analysis });
  const t2 = performance.now();
  const layers: Record<string, HTMLCanvasElement> = {};
  for (const [k, l] of Object.entries(s.layers)) layers[k] = toCanvas(l);
  return { def, s, rig: r.rig, bound, image: toCanvas(s.image), layers, rigMs: t1 - t0, bindMs: t2 - t1 };
}

const artHeight = (b: BoundRig) => {
  let top = Infinity;
  for (let i = 1; i < b.rest.length; i += 2) top = Math.min(top, b.rest[i]);
  return b.rig.anchor[1] - top;
};

const TRAVEL: Record<string, number> = { walk: 1.2, run: 3.2 };

/** Drives a rigged character through the adapter's own update() to frame f of n of a clip. */
function advanceTo(ch: RiggedMesh, L: Loaded, name: string, f: number, n: number): void {
  const clip = resolveClip(L.rig.kind, name)!;
  const face: 1 | -1 = L.rig.facing === -1 ? -1 : 1;
  ch.face(face);
  const o = ch.object;
  const x0 = o.x;
  const v = (TRAVEL[clip.name] ?? 0) * artHeight(L.bound) * o.scaleX;
  const adv = (dt: number) => {
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(1 / 60, left);
      if (v) o.x += v * h * face;
      ch.update(h * 1000);
      left -= h;
    }
  };
  adv(0.25);
  ch.play(clip.name, { fade: 0, loop: clip.loop });
  if (clip.loop) adv(clip.dur);
  adv(clip.loop ? (f * clip.dur) / n : Math.min(clip.dur - 1e-3, (f * clip.dur) / Math.max(1, n - 1)));
  // back to its cell without another update, so the move isn't seen as motion
  o.x = x0;
}

function menu(): void {
  const nav = document.getElementById('nav')!;
  const link = (href: string, text: string) => {
    const a = Object.assign(document.createElement('a'), { href, textContent: text });
    nav.appendChild(a);
  };
  link('?mode=live', 'live');
  link('?mode=perf&n=20', 'perf (20)');
  link('?mode=preview', 'canvas previews');
  link('?mode=worker', 'worker');
  link('?mode=editing', 'editing');
  for (const d of SAMPLES) link(`?mode=sheet&sample=${d.name}`, `sheet: ${d.name}`);
  done();
}

function sheet(): void {
  const L = load(q.get('sample') ?? 'hero');
  const n = Number(q.get('frames') ?? 8);
  const cell = Number(q.get('cell') ?? 110);
  const clips = q.get('clips')?.split(',') ?? clipsFor(L.rig.kind);
  const sims = clips.map((c) => sampleClip(L.bound, c, n)).filter((s) => !!s);
  const k = cell / artHeight(L.bound);
  const pad = 6, labelW = 64;
  const rows = sims.map((s) => unionBounds([s]));
  const all = unionBounds(sims);
  const cw = Math.ceil((all.x1 - all.x0) * k + 2 * pad);
  const heights = rows.map((u) => Math.ceil((u.y1 - u.y0) * k + 2 * pad));
  const W = labelW + cw * n, H = heights.reduce((a, b) => a + b, 0);
  const canvasMode = q.get('canvas') === '1';
  log(`${L.def.name}: rig ${L.rigMs.toFixed(1)} ms, bind ${L.bindMs.toFixed(1)} ms, ${L.bound.stats.triangles} triangles, ${L.bound.stats.parts} parts; rows: ${sims.map((s) => s.clip).join(' ')}`);
  new Phaser.Game({
    type: canvasMode ? Phaser.CANVAS : Phaser.WEBGL,
    width: W,
    height: H,
    parent: stage,
    backgroundColor: '#f4efe4',
    banner: false,
    scene: {
      create(this: Phaser.Scene) {
        const g = this.add.graphics();
        let y0 = 0;
        sims.forEach((sim, r) => {
          const u = rows[r], ch = heights[r];
          g.fillStyle(r % 2 ? 0xfdf8ec : 0xf6eedb, 1).fillRect(0, y0, W, ch);
          this.add.text(6, y0 + ch / 2 - 8, sim.clip, { color: '#221b2e', fontSize: '13px', fontFamily: 'sans-serif' });
          for (let f = 0; f < n; f++) {
            const ax = labelW + f * cw + pad - all.x0 * k, ay = y0 + pad - u.y0 * k;
            g.lineStyle(1, 0xd8c9a6, 1).lineBetween(labelW + f * cw + 4, ay, labelW + (f + 1) * cw - 4, ay);
            const c = createRiggedMesh(this, ax, ay, { key: L.def.name, rig: L.rig, image: L.image, layers: L.layers }) as RiggedMesh;
            c.object.setScale(k);
            advanceTo(c, L, sim.clip, f, n);
          }
          y0 += ch;
        });
        this.game.events.once('postrender', () => {
          // a still sheet: stop the loop so screenshots don't compete for the CPU
          this.game.loop.sleep();
          done({ sample: L.def.name, clips: sims.map((s) => s.clip), width: W, height: H, rigMs: L.rigMs, bindMs: L.bindMs, triangles: L.bound.stats.triangles });
        });
      },
    },
  });
}

interface Runner {
  ch: RiggedMesh;
  cont: Phaser.GameObjects.Container;
  body: Phaser.Physics.Arcade.Body;
  speed: number;
  dir: 1 | -1;
  jumpAt: number;
  tris: number;
}

function world(count: number, measure: boolean): void {
  const names = SAMPLES.map((d) => d.name);
  const loaded = new Map<string, Loaded>();
  const pick = (i: number) => {
    const name = names[i % names.length];
    if (!loaded.has(name)) loaded.set(name, load(name));
    return loaded.get(name)!;
  };
  const W = 1280, H = 720;
  const cols = Math.min(count, 8);
  const lanes = Math.ceil(count / cols);
  const laneH = H / lanes;
  const runners: Runner[] = [];
  const samples: { rig: number; frame: number }[] = [];
  let frameStart = 0;
  let frames = 0;
  new Phaser.Game({
    type: Phaser.WEBGL,
    width: W,
    height: H,
    parent: stage,
    backgroundColor: '#1b1f52',
    banner: false,
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 1400 } } },
    scene: {
      create(this: Phaser.Scene) {
        const g = this.add.graphics();
        for (let l = 0; l < lanes; l++) {
          const gy = (l + 1) * laneH - 12;
          g.fillStyle(0x2e3478, 1).fillRect(0, gy, W, 12);
          const floor = this.add.zone(W / 2, gy + 6, W, 12);
          this.physics.add.existing(floor, true);
          (floor as unknown as { lane: number }).lane = l;
        }
        const floors = this.children.list.filter((o) => o.type === 'Zone');
        for (let i = 0; i < count; i++) {
          const L = pick(i);
          const lane = Math.floor(i / cols);
          const h = Math.min(laneH * 0.62, 150);
          const k = h / artHeight(L.bound);
          const w = Math.max(24, L.bound.width * k * 0.5);
          const cont = this.add.container(((i % cols) + 0.5) * (W / cols), (lane + 1) * laneH - 12 - h / 2);
          cont.setSize(w, h);
          this.physics.add.existing(cont);
          const body = cont.body as Phaser.Physics.Arcade.Body;
          body.setCollideWorldBounds(true);
          const ch = createRiggedMesh(this, 0, h / 2, { key: L.def.name, rig: L.rig, image: L.image, layers: L.layers }) as RiggedMesh;
          ch.object.setScale(k);
          cont.add(ch.object);
          const flying = L.rig.kind === 'flyer' || L.rig.kind === 'swimmer';
          if (flying) body.setAllowGravity(false);
          else this.physics.add.collider(cont, floors[lane] as Phaser.GameObjects.Zone);
          ch.follow(body);
          runners.push({ ch, cont, body, speed: (0.6 + 0.9 * ((i * 7) % 5) / 4) * h, dir: i % 2 ? -1 : 1, jumpAt: 1 + (i % 4), tris: L.bound.stats.triangles });
        }
        this.game.events.on('prestep', () => {
          frameStart = performance.now();
        });
        this.game.events.on('postrender', () => {
          const t = performance.now() - frameStart;
          const rig = runners.reduce((a, r) => a + r.ch.stepMs, 0);
          frames++;
          if (frames > 60 && samples.length < 300) samples.push({ rig, frame: t });
          if (samples.length === 240 || (!measure && frames === 90)) {
            const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
            const p95 = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.95)];
            const rigs = samples.map((s) => s.rig), fr = samples.map((s) => s.frame);
            const tris = runners.reduce((a, r) => a + r.tris, 0);
            const info = measure && samples.length
              ? { count, triangles: tris, rigMedianMs: med(rigs), rigP95Ms: p95(rigs), frameMedianMs: med(fr), frameP95Ms: p95(fr), perCharacterUs: (med(rigs) / count) * 1000 }
              : { count, triangles: tris };
            if (measure) log(JSON.stringify(info, null, 1));
            done(info);
          }
        });
      },
      update(this: Phaser.Scene, time: number, delta: number) {
        for (const r of runners) {
          const b = r.body;
          if ((b.blocked.left && r.dir < 0) || (b.blocked.right && r.dir > 0)) r.dir = r.dir === 1 ? -1 : 1;
          b.setVelocityX(r.dir * r.speed);
          if (!b.allowGravity) b.setVelocityY(Math.sin(time / 600 + r.speed) * 60);
          else if (b.blocked.down && time / 1000 > r.jumpAt) {
            b.setVelocityY(-620);
            r.jumpAt = time / 1000 + 2 + (r.speed % 3);
          }
          r.ch.face(r.dir);
          r.ch.update(delta);
        }
      },
    },
  });
}

function preview(): void {
  const row = Object.assign(document.createElement('div'), { className: 'row' });
  stage.appendChild(row);
  const names = ['hero', 'dog', 'slime', 'bird', 'car', 'layered'];
  const previews = names.map((name) => {
    const L = load(name);
    const c = Object.assign(document.createElement('canvas'), { width: 220, height: 190 });
    row.appendChild(c);
    const p = createRigPreview(c, { wander: true, bones: name === 'hero' ? { look: 'stars', width: 1.5, joint: 2.2, glow: 4 } : undefined });
    p.show(L.bound);
    p.walkTo(40);
    return p;
  });
  // a still in the Bones view's diagram look, a template, and a contact sheet from the canvas path
  const L = load('hero');
  const still = Object.assign(document.createElement('canvas'), { width: 260, height: 330 });
  row.appendChild(still);
  const ctx = still.getContext('2d')!;
  const k = 300 / artHeight(L.bound);
  drawRigged(ctx, L.bound, null, { x: 130, y: 318, scale: k });
  drawBones(ctx, L.rig, restBonePoints(L.rig), { look: 'diagram', x: 130, y: 318, scale: k, joint: 7, width: 14, ground: true });
  const tpl = Object.assign(document.createElement('canvas'), { width: 200, height: 330 });
  row.appendChild(tpl);
  const t = templateFor('biped', 160, 300);
  drawBones(tpl.getContext('2d')!, t, restBonePoints(t), { look: 'stars', x: 100, y: 315, scale: 1, width: 2, joint: 3.2, glow: 7, ground: true });
  const sheetCanvas = renderContactSheet(L.bound, { clips: ['walk', 'run', 'jump', 'attack', 'hurt'], frames: 8, size: 90, background: '#fdf8ec', grid: '#e9dcc0' });
  const holder = Object.assign(document.createElement('div'), { className: 'row' });
  stage.appendChild(holder);
  holder.appendChild(sheetCanvas as HTMLCanvasElement);
  setTimeout(() => done({ previews: previews.map((p) => p.clip) }), 1200);
}

async function workerMode(): Promise<void> {
  const w = createRigWorker();
  let longest = 0, last = performance.now(), beating = true;
  const beat = () => {
    const t = performance.now();
    longest = Math.max(longest, t - last);
    last = t;
    if (beating) requestAnimationFrame(beat);
  };
  requestAnimationFrame(beat);
  const rows: string[] = [];
  const results: Record<string, unknown>[] = [];
  for (const def of SAMPLES) {
    const s = def.draw();
    const t0 = performance.now();
    const r = await w.autoRig({ image: s.image, layers: s.layers }, { kind: s.kind });
    const t1 = performance.now();
    const b = await w.bind({ image: s.image, layers: s.layers }, r.rig);
    const t2 = performance.now();
    const again = await w.bind({ image: s.image, layers: s.layers }, r.rig);
    const t3 = performance.now();
    rows.push(`${def.name.padEnd(10)} autoRig ${(t1 - t0).toFixed(0)} ms (in worker ${r.ms.toFixed(0)}), bind ${(t2 - t1).toFixed(0)} ms, cached bind ${(t3 - t2).toFixed(0)} ms, confidence ${r.confidence}, ${b.stats.triangles}/${again.stats.triangles} tris`);
    results.push({ name: def.name, autoRigMs: t1 - t0, bindMs: t2 - t1, cachedBindMs: t3 - t2, confidence: r.confidence });
  }
  const s = SAMPLES[0].draw();
  const r = await w.autoRig({ image: s.image }, { kind: 'biped' });
  const strip = await w.strip({ image: s.image }, r.rig, 'walk', { frames: 8, size: 100 });
  const row = Object.assign(document.createElement('div'), { className: 'row' });
  stage.appendChild(row);
  for (const f of strip.frames) {
    const c = Object.assign(document.createElement('canvas'), { width: f.width, height: f.height });
    c.getContext('2d')!.drawImage(f, 0, 0);
    row.appendChild(c);
  }
  beating = false;
  rows.push(`strip: ${strip.frames.length} frames ${strip.meta.width}x${strip.meta.height}, ${strip.meta.fps.toFixed(1)} fps; longest main-thread frame ${longest.toFixed(0)} ms`);
  log(rows.join('\n'));
  done({ results, longestFrameMs: longest, stripFrames: strip.frames.length });
}

function editingMode(): void {
  // a quick visual check of edits: mirror a one-armed rig, move an elbow, add a tail
  const L = load('hero');
  let rig = L.rig;
  rig = moveJoint(rig, 'armL2', rig.bones[3].x2 - 20, rig.bones[3].y2 + 10);
  rig = mirrorSides(rig, 'L');
  rig = addDynamic(rig, 'hips', [rig.anchor[0] + 60, rig.anchor[1] - 40]);
  const bound = bindRig(L.s, rig);
  const c = Object.assign(document.createElement('canvas'), { width: 300, height: 340 });
  stage.appendChild(c);
  const ctx = c.getContext('2d')!;
  drawRigged(ctx, bound, null, { x: 150, y: 330, scale: 1 });
  drawBones(ctx, rig, restBonePoints(rig), { look: 'diagram', x: 150, y: 330, joint: 6, width: 12 });
  done({ bones: rig.bones.length });
}

switch (mode) {
  case 'sheet': sheet(); break;
  case 'live': world(SAMPLES.length, false); break;
  case 'perf': world(Number(q.get('n') ?? 20), true); break;
  case 'preview': preview(); break;
  case 'worker': void workerMode(); break;
  case 'editing': editingMode(); break;
  default: menu();
}
