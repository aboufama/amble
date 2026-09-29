// Harness page for the art engine: a bare-bones UI around createArtSurface plus `window.__art`, the API the
// Playwright scripts drive. Query: w, h, kind, pixel=1, perf=1 (HUD), probe=1 (forced raster timings),
// desync=0, worker=0, layers=colors,lines.
import {
  type ArtScript,
  type ArtSurface,
  type LayerRole,
  type ToolId,
  createArtSurface,
  deserializeArtDoc,
  exportArtDoc,
  playTimelapse,
  replayArtScript,
  replayLog,
  serializeArtDoc,
} from '../../src/art/engine';

const qs = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (qs.has(k) ? Number(qs.get(k)) : d);
const host = document.getElementById('desk') as HTMLDivElement;

let surface: ArtSurface = make(null);

function make(doc: Parameters<typeof createArtSurface>[1]): ArtSurface {
  const s = createArtSurface(host, doc, {
    width: num('w', 1024),
    height: num('h', 1024),
    kind: (qs.get('kind') as 'character' | null) ?? 'character',
    pixelArt: qs.get('pixel') === '1',
    layers: qs.get('layers') ? (qs.get('layers')!.split(',') as LayerRole[]) : undefined,
    desynchronized: qs.has('desync') ? qs.get('desync') !== '0' : undefined,
    worker: qs.get('worker') !== '0',
    perfProbe: qs.get('probe') === '1',
    reducedMotion: qs.get('motion') === '0',
  });
  s.on('toast', (t) => toast(t.message));
  s.on('layers', () => refreshSide());
  s.on('frames', () => refreshSide());
  s.on('tool', () => refreshBar());
  s.on('history', () => refreshBar());
  return s;
}

// ---------------------------------------------------------------------------------------------- chrome

const TOOLS: Array<[ToolId, string]> = [
  ['ink', 'Ink'],
  ['pencil', 'Pencil'],
  ['marker', 'Marker'],
  ['crayon', 'Crayon'],
  ['airbrush', 'Airbrush'],
  ['eraser', 'Eraser'],
  ['pixel', 'Pixel'],
  ['fill', 'Fill'],
  ['eyedropper', 'Pick'],
  ['lasso', 'Lasso'],
  ['select', 'Box'],
  ['pan', 'Hand'],
];
const SWATCHES = ['#2b1d16', '#ffffff', '#8a8f98', '#e8443a', '#f5a142', '#ffd23f', '#7cc95a', '#2fa36b', '#3aa7e8', '#3d5bd9', '#8e5ad6', '#ff8fa3', '#ffe9d6', '#f2c9a0', '#c98e5e', '#8a5a3b'];
const bar = document.getElementById('bar')!;

function button(label: string, onClick: () => void, extra?: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = onClick;
  extra?.(b);
  bar.append(b);
  return b;
}

const toolButtons = TOOLS.map(([id, label]) => button(label, () => surface.setTool(id), (b) => (b.dataset.tool = id)));
for (const c of SWATCHES)
  button('', () => surface.setColor(c), (b) => {
    b.className = 'sw';
    b.style.background = c;
    b.setAttribute('aria-label', c);
  });
const size = document.createElement('input');
size.type = 'range';
size.min = '1';
size.max = '80';
size.oninput = () => surface.setBrush({ size: Number(size.value) });
bar.append(' size ', size);
const undoB = button('Undo', () => void surface.undo());
const redoB = button('Redo', () => void surface.redo());
button('Perfect', () => void surface.makeLastStrokePerfect());
button('Mirror', () => surface.setMirror(surface.toolState().mirror.x === null ? { x: true } : null));
button('Fit', () => surface.fit());
let onion = false;
button('Onion', () => {
  onion = !onion;
  surface.setOnion({ enabled: onion });
});
button('+Page', () => void surface.addFrame({ copy: false }));
button('Watch', () => void watch());

function refreshBar(): void {
  const t = surface.toolState();
  for (const b of toolButtons) b.setAttribute('aria-pressed', String(b.dataset.tool === t.tool));
  const brush = (['ink', 'pencil', 'marker', 'crayon', 'airbrush', 'eraser', 'pixel'] as const).find((x) => x === t.tool);
  if (brush) size.value = String(Math.round(t.brushes[brush].size));
  const h = surface.historyState();
  undoB.disabled = !h.canUndo;
  redoB.disabled = !h.canRedo;
}

function refreshSide(): void {
  const ul = document.getElementById('layers')!;
  ul.innerHTML = '';
  for (const l of [...surface.layers()].reverse()) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(l.active));
    li.textContent = `${l.visible ? '●' : '○'} ${l.name} (${l.role})`;
    li.onclick = (e) => {
      if (e.altKey) surface.setLayer(l.id, { visible: !l.visible });
      else surface.setActiveLayer(l.id);
    };
    ul.append(li);
  }
  const fl = document.getElementById('frames')!;
  fl.innerHTML = '';
  for (const f of surface.frames()) {
    const li = document.createElement('li');
    li.setAttribute('aria-selected', String(f.active));
    li.textContent = `Page ${f.index + 1}`;
    li.onclick = () => void surface.setActiveFrame(f.id);
    fl.append(li);
  }
}

let toastTimer = 0;
function toast(msg: string): void {
  const t = document.getElementById('toast')!;
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('on'), 1400);
}

if (qs.get('perf') === '1')
  setInterval(() => {
    const s = surface.stats();
    document.getElementById('hud')!.textContent = [
      `input→pixels p50 ${s.latency.p50} p95 ${s.latency.p95} ms`,
      `frame work p50 ${s.work.p50} p95 ${s.work.p95} ms`,
      `pen-up p50 ${s.commit.p50} p95 ${s.commit.p95} ms`,
      `undo ${s.history.steps} steps ${(s.history.bytes / 1048576).toFixed(1)} MB`,
      `pixels ${(s.pixels / 1048576).toFixed(0)} MB`,
      `desync ${s.desynchronized} raw ${s.rawUpdates} worker ${s.worker}`,
    ].join('\n');
  }, 500);

async function watch(): Promise<void> {
  const doc = await surface.toArtDoc();
  surface.destroy();
  host.innerHTML = '';
  const p = playTimelapse(host, doc, { speed: 8 });
  p.on('end', () => toast('That is how it was drawn!'));
}

// ---------------------------------------------------------------------------------------------- test API

async function blobToDataUrl(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${b.type || 'application/octet-stream'};base64,${btoa(s)}`;
}

function toBytes(dataUrl: string): Uint8Array {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const api = {
  get surface(): ArtSurface {
    return surface;
  },
  ready: (): Promise<void> => surface.ready,
  docToClient: (x: number, y: number): [number, number] => {
    const p = surface.docToClient(x, y);
    return [p.x, p.y];
  },
  /** Centres board point (cx, cy) at `zoom` and `rotDeg`. */
  look(zoom: number, rotDeg = 0, cx = surface.width / 2, cy = surface.height / 2): void {
    const v = surface.view();
    const rot = (rotDeg * Math.PI) / 180;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    surface.setView({ zoom, rot, panX: v.cssW / 2 - (cx * c - cy * s) * zoom, panY: v.cssH / 2 - (cx * s + cy * c) * zoom });
  },
  layerId(role: string): string | null {
    return surface.layers().find((l) => l.role === role)?.id ?? null;
  },
  setLayerByRole(role: string): void {
    const id = api.layerId(role);
    if (id) surface.setActiveLayer(id);
  },
  pixel(layer: string | null, x: number, y: number): number[] {
    return [...surface.readPixels(layer, Math.floor(x), Math.floor(y), 1, 1)];
  },
  /** Sum of alpha/255 in a board rect of a layer (null = composite). */
  coverage(layer: string | null, x: number, y: number, w: number, h: number): number {
    const px = surface.readPixels(layer, x, y, w, h);
    let n = 0;
    for (let i = 3; i < px.length; i += 4) n += px[i] / 255;
    return n;
  },
  /** A checksum of a layer's visible pixels (colour bytes of fully transparent pixels count as zero). */
  hash(layer: string | null): number {
    const px = surface.readPixels(layer, 0, 0, surface.width, surface.height);
    let h = 2166136261;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      h = Math.imul(h ^ (a ? px[i] : 0), 16777619);
      h = Math.imul(h ^ (a ? px[i + 1] : 0), 16777619);
      h = Math.imul(h ^ (a ? px[i + 2] : 0), 16777619);
      h = Math.imul(h ^ a, 16777619);
    }
    return h >>> 0;
  },
  async exportArt(o: Parameters<ArtSurface['export']>[0] = {}): Promise<unknown> {
    const ex = await surface.export(o);
    if (!ex) return null;
    return {
      flat: await blobToDataUrl(ex.flat.png),
      w: ex.flat.w,
      h: ex.flat.h,
      box: ex.box,
      anchor: ex.anchor,
      anchorBoard: ex.anchorBoard,
      scale: ex.scale,
      bytes: ex.flat.png.size,
      layers: await Promise.all(ex.layers.map(async (l) => ({ role: l.role, name: l.name, part: l.part, x: l.x, y: l.y, w: l.w, h: l.h, bytes: l.png.size, png: await blobToDataUrl(l.png) }))),
      linesMask: ex.linesMask ? await blobToDataUrl(ex.linesMask.png) : null,
      thumb: await blobToDataUrl(ex.thumb.png),
    };
  },
  async saveDoc(): Promise<{ data: string; bytes: number; cels: Array<{ layer: string; bytes: number; w: number; h: number }>; logBytes: number }> {
    const doc = await surface.toArtDoc();
    const bin = await serializeArtDoc(doc);
    return { data: await blobToDataUrl(new Blob([bin as Uint8Array<ArrayBuffer>])), bytes: bin.length, cels: doc.cels.map((c) => ({ layer: c.layer, bytes: c.png.size, w: c.w, h: c.h })), logBytes: doc.strokeLog?.size ?? 0 };
  },
  async loadDoc(data: string): Promise<void> {
    const doc = await deserializeArtDoc(toBytes(data));
    surface.destroy();
    host.innerHTML = '';
    surface = make(doc);
    await surface.ready;
    refreshSide();
    refreshBar();
  },
  async replayScript(script: ArtScript, scale = 1): Promise<unknown> {
    const t0 = performance.now();
    const doc = await replayArtScript(script);
    const ms = performance.now() - t0;
    const ex = await exportArtDoc(doc, { scale });
    return { ms, flat: ex ? await blobToDataUrl(ex.flat.png) : null, anchor: ex?.anchor ?? null };
  },
  async timelapse(speed = 8): Promise<number> {
    const doc = await surface.toArtDoc();
    surface.destroy();
    host.innerHTML = '';
    const p = playTimelapse(host, doc, { speed });
    const t0 = performance.now();
    await new Promise<void>((r) => p.on('end', () => r()));
    return performance.now() - t0;
  },
  /**
   * Checks that the screen shows exactly the document: renders the expected composite in JS (paper plus
   * visible layers) and compares it with the view canvas at 1:1 over the visible part. Returns the number
   * of pixels off by more than `tol` and the first one.
   */
  async checkView(tol = 6): Promise<{ bad: number; checked: number; first: number[] | null }> {
    await surface.settled();
    const v = surface.view();
    const panX = Math.round((v.cssW - surface.width) / 2);
    const panY = Math.round((v.cssH - surface.height) / 2);
    surface.setView({ zoom: 1, rot: 0, panX, panY });
    const canvas = host.querySelector('canvas') as HTMLCanvasElement;
    const dpr = canvas.width / v.cssW;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const x0 = Math.max(0, -panX);
    const y0 = Math.max(0, -panY);
    const x1 = Math.min(surface.width, Math.floor(v.cssW) - panX);
    const y1 = Math.min(surface.height, Math.floor(v.cssH) - panY);
    const w = x1 - x0;
    const h = y1 - y0;
    const shown = ctx.getImageData(Math.round((panX + x0) * dpr), Math.round((panY + y0) * dpr), Math.round(w * dpr), Math.round(h * dpr)).data;
    const paper = [255, 253, 247];
    const exp = new Float64Array(w * h * 3);
    for (let i = 0; i < w * h; i++) exp.set(paper, i * 3);
    for (const l of surface.layers()) {
      if (!l.visible) continue;
      const px = surface.readPixels(l.id, x0, y0, w, h);
      for (let i = 0; i < w * h; i++) {
        const a = (px[i * 4 + 3] / 255) * l.opacity;
        if (!a) continue;
        for (let k = 0; k < 3; k++) {
          const d = exp[i * 3 + k];
          const s = l.blend === 'multiply' ? (px[i * 4 + k] * d) / 255 : px[i * 4 + k];
          exp[i * 3 + k] = s * a + d * (1 - a);
        }
      }
    }
    let bad = 0;
    let first: number[] | null = null;
    const sw = Math.round(w * dpr);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const j = (Math.round(y * dpr) * sw + Math.round(x * dpr)) * 4;
        const i = (y * w + x) * 3;
        const off = Math.max(Math.abs(shown[j] - exp[i]), Math.abs(shown[j + 1] - exp[i + 1]), Math.abs(shown[j + 2] - exp[i + 2]));
        if (off > tol) {
          bad++;
          first ??= [x0 + x, y0 + y, shown[j], shown[j + 1], shown[j + 2], Math.round(exp[i]), Math.round(exp[i + 1]), Math.round(exp[i + 2])];
        }
      }
    return { bad, checked: w * h, first };
  },
  /** Replays the stroke log headlessly and compares every layer of every frame with the live pixels. */
  async replayCheck(): Promise<{ layers: number; mismatched: string[]; ms: number }> {
    await surface.settled();
    const t0 = performance.now();
    const board = await replayLog(surface.log());
    const ms = performance.now() - t0;
    const mismatched: string[] = [];
    let layers = 0;
    for (const f of surface.frames())
      for (const l of surface.layers()) {
        layers++;
        const live = surface.readPixels(l.id, 0, 0, surface.width, surface.height, f.id);
        const re = board.pixels(f.id, l.id);
        let bad = 0;
        let box: number[] | null = null;
        for (let i = 0; i < live.length; i += 4)
          if (live[i] !== (re ? re[i] : 0) || live[i + 1] !== (re ? re[i + 1] : 0) || live[i + 2] !== (re ? re[i + 2] : 0) || live[i + 3] !== (re ? re[i + 3] : 0)) {
            bad++;
            const x = (i >> 2) % surface.width;
            const y = Math.floor((i >> 2) / surface.width);
            box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y];
          }
        if (bad) mismatched.push(`${l.name} (page ${f.index + 1}): ${bad} px in [${box?.join(',')}]`);
      }
    return { layers, mismatched, ms };
  },
  stats: () => surface.stats(),
  resetStats: (): void => (surface as unknown as { resetStats(): void }).resetStats(),
  info: () => ({ secure: isSecureContext, dpr: devicePixelRatio, raw: 'onpointerrawupdate' in window, ua: navigator.userAgent }),
};

declare global {
  interface Window {
    __art: typeof api;
  }
}
window.__art = api;

void surface.ready.then(() => {
  refreshSide();
  refreshBar();
  host.focus();
});
