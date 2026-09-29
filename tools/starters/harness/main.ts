/**
 * The starters' review harness (tools/starters/review.mjs drives it): opens a starter or a seed with the
 * real catalog and the committed files, plays it in the real sandboxed player, robot-tests it, and draws
 * rig contact sheets with the rig engine. `window.starters` is the API the review script calls.
 */
import runtimeUrl from 'virtual:amble-runtime';
import { Player, type DrawnArt, type GameBundle, type RobotReport } from '../../../src/play/index';
import { createStarterCatalog } from '../../../src/starters/api';
import { STARTERS } from '../../../src/starters/catalog';
import { bindRig, parseRig, renderContactSheet } from '../../../src/rig/index';
import { blobRefOf } from '../../../src/model/ids';
import type { ArtRecord, SeedId, World } from '../../../src/model/types';

const stage = document.getElementById('stage') as HTMLDivElement;
const logEl = document.getElementById('log') as HTMLPreElement;
const select = document.getElementById('starter') as HTMLSelectElement;
const withArtBox = document.getElementById('withArt') as HTMLInputElement;
const sheet = document.getElementById('sheet') as HTMLCanvasElement;

const catalog = createStarterCatalog({ base: '/', level: () => 'middle' });
const player = new Player({ container: stage, runtimeUrl, title: 'Starter' });
const log: Array<{ type: string; data: unknown }> = [];
const note = (type: string, data: unknown) => {
  log.push({ type, data });
  if (type === 'stats') return;
  logEl.textContent = (`${type} ${JSON.stringify(data)?.slice(0, 400)}\n` + (logEl.textContent ?? '')).slice(0, 30000);
};
for (const ev of ['state', 'firstFrame', 'error', 'warn', 'log', 'event', 'artMissing', 'swapped', 'csp'] as const) {
  player.on(ev, ((...a: unknown[]) => note(ev, a.length === 1 ? a[0] : a)) as never);
}
player.on('manifest', (m) => note('manifest', { title: m.title, art: m.art.map((a) => `${a.key}${a.drawn ? '*' : ''}`), dials: m.dials.map((d) => d.key), twists: m.twists.filter((t) => t.available).map((t) => t.id) }));

interface Opened {
  world: World;
  art: ArtRecord[];
  byRef: Map<string, Blob>;
}

async function openIt(id: SeedId, withArt: boolean, heroFrom?: SeedId): Promise<Opened> {
  const { world, art, blobs } = await catalog.open(id, { withArt });
  const byRef = new Map<string, Blob>();
  for (const b of blobs) byRef.set(await blobRefOf(b), b);
  if (heroFrom) {
    // A seed with another starter's hero as the student's drawing ("Give Blorp a world").
    const other = await catalog.open(heroFrom, { withArt: true });
    const heroKey = STARTERS.find((s) => s.id === heroFrom)?.heroKey ?? 'hero';
    const hero = other.art.find((a) => a.id === other.world.cast[heroKey]?.art);
    if (hero) {
      for (const b of other.blobs) byRef.set(await blobRefOf(b), b);
      const key = catalog.info(id).heroKey;
      world.cast[key] = { ...world.cast[key], art: hero.id, madeBy: 'student' };
      art.push(hero);
    }
  }
  return { world, art, byRef };
}

function drawnArt(o: Opened): DrawnArt[] {
  const out: DrawnArt[] = [];
  for (const slot of Object.values(o.world.cast)) {
    const rec = o.art.find((a) => a.id === slot.art);
    if (!rec?.export) continue;
    const image = o.byRef.get(rec.export.flat);
    if (!image) continue;
    const art: DrawnArt = { key: slot.key, image };
    if (rec.rigData) art.rig = rec.rigData;
    const layers: Record<string, Blob> = {};
    for (const [name, p] of Object.entries(rec.export.parts)) {
      const b = o.byRef.get(p.blob);
      if (b) layers[name] = b;
    }
    if (Object.keys(layers).length) art.layers = layers;
    out.push(art);
  }
  return out;
}

interface LoadOptions {
  withArt?: boolean;
  heroFrom?: SeedId;
  autostart?: boolean;
  dials?: Record<string, number>;
  twists?: string[];
}

async function bundleFor(id: SeedId, o: LoadOptions): Promise<GameBundle> {
  const opened = await openIt(id, o.withArt ?? true, o.heroFrom);
  return {
    files: opened.world.code.map((f) => ({ name: f.path, source: f.source })),
    art: drawnArt(opened),
    dials: o.dials,
    twists: o.twists,
    autostart: o.autostart,
  };
}

async function load(id: SeedId, o: LoadOptions = {}): Promise<number> {
  log.length = 0;
  const t0 = performance.now();
  await player.load(await bundleFor(id, o));
  player.focus();
  return Math.round(performance.now() - t0);
}

async function robot(id: SeedId, o: LoadOptions & { gameMs?: number; seed?: number } = {}): Promise<RobotReport> {
  return player.robotTest(await bundleFor(id, o), { gameMs: o.gameMs ?? 6000, seed: o.seed ?? 1, bot: 'auto' });
}

async function pixelsOf(b: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(b);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

/** Every move of a drawn character, with or without its bones, as a PNG data URL. */
async function rigSheet(id: SeedId, key: string, o: { bones?: boolean; clips?: string[]; size?: number; face?: 1 | -1 } = {}): Promise<string> {
  const opened = await openIt(id, true);
  const rec = opened.art.find((a) => a.id === opened.world.cast[key]?.art);
  if (!rec?.export || !rec.rigData) throw new Error(`${id}/${key} has no rig`);
  const image = await pixelsOf(opened.byRef.get(rec.export.flat) as Blob);
  const layers: Record<string, ImageData> = {};
  for (const [name, p] of Object.entries(rec.export.parts)) layers[name] = await pixelsOf(opened.byRef.get(p.blob) as Blob);
  const bound = bindRig({ image, layers }, parseRig(rec.rigData));
  const c = renderContactSheet(bound, { clips: o.clips, size: o.size ?? 150, frames: 8, bones: o.bones, background: '#f4ecdc', title: `${id} / ${key}`, face: o.face }) as HTMLCanvasElement | OffscreenCanvas;
  sheet.width = c.width;
  sheet.height = c.height;
  (sheet.getContext('2d') as CanvasRenderingContext2D).drawImage(c as CanvasImageSource, 0, 0);
  return sheet.toDataURL('image/png');
}

/** A 960x540 PNG (data URL) of the stage, scaled into w x h. */
async function shrink(dataUrl: string, w: number, h: number): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/png');
}

for (const s of STARTERS) {
  const opt = document.createElement('option');
  opt.value = s.id;
  opt.textContent = s.id;
  select.append(opt);
}
document.getElementById('play')?.addEventListener('click', () => void load(select.value as SeedId, { withArt: withArtBox.checked }));
document.getElementById('robot')?.addEventListener('click', () => void robot(select.value as SeedId, { withArt: withArtBox.checked }).then((r) => note('robot', { pass: r.pass, reasons: r.reasons, notes: r.notes })));
const forward = (e: KeyboardEvent) => {
  if (player.forwardKey(e)) e.preventDefault();
};
window.addEventListener('keydown', forward);
window.addEventListener('keyup', forward);

const api = { ids: STARTERS.map((s) => s.id), player, log, load, robot, rigSheet, shrink, catalog };
(window as unknown as { starters: typeof api }).starters = api;
