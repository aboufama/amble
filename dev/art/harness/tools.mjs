// Selection (lasso and box: move, scale, rotate, flip, arrow keys, "make this a part", scope), eyedropper,
// flipbook pages with onion skin and playback, the guide overlay and trace-a-photo.
import { launch, humanStroke, sendStroke, ellipse, line, polyline, shot, saveJson, sleep, settle, tap } from './lib.mjs';

const out = {};
let seed = 70;
const pen = (page, cdp, path, o = {}) => sendStroke(page, cdp, humanStroke(path, { seed: seed++, speed: 700, ...o }));
/** A mouse drag through board points (selection outlines and handle drags). */
const drag = (page, cdp, pts, n = 40) => {
  const path = polyline(pts);
  const samples = Array.from({ length: n + 1 }, (_, i) => ({ ...path(i / n), p: 0.5 }));
  return sendStroke(page, cdp, samples, { kind: 'mouse', hz: 120 });
};
const arc = (c, r, a0, a1, n = 40) => Array.from({ length: n + 1 }, (_, i) => {
  const a = a0 + ((a1 - a0) * i) / n;
  return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a), p: 0.5 };
});

/** Handle positions (board px) from the selection info, as the engine places them. */
function handles(info, zoom) {
  const [x, y, w, h] = info.box;
  const t = info.transform;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const c = Math.cos(t.rot);
  const s = Math.sin(t.rot);
  const m = [c * t.sx, s * t.sx, -s * t.sy, c * t.sy];
  const e = cx + t.tx - (m[0] * cx + m[2] * cy);
  const f = cy + t.ty - (m[1] * cx + m[3] * cy);
  const ap = (px, py) => ({ x: m[0] * px + m[2] * py + e, y: m[1] * px + m[3] * py + f });
  const top = ap(x + w / 2, y);
  const len = Math.hypot(m[2], m[3]) || 1;
  const k = 30 / zoom;
  return { corners: [ap(x, y), ap(x + w, y), ap(x + w, y + h), ap(x, y + h)], rotate: { x: top.x - (m[2] / len) * k, y: top.y - (m[3] / len) * k }, center: { x: cx + t.tx, y: cy + t.ty } };
}

async function selectionPart() {
  const { browser, page, cdp } = await launch({});
  const S = (f, ...a) => page.evaluate(([f, a]) => window.__art.surface[f](...a), [f, a]);
  const A = (f, ...a) => page.evaluate(([f, a]) => window.__art[f](...a), [f, a]);
  try {
    const lines = await A('layerId', 'lines');
    const colors = await A('layerId', 'colors');
    // A little robot: head, body, one arm with a hand.
    await S('setBrush', { size: 8 });
    await pen(page, cdp, ellipse(512, 300, 105, 95, -95, 362));
    await pen(page, cdp, ellipse(512, 590, 165, 175, -95, 362));
    await pen(page, cdp, line(668, 540, 842, 452, -10));
    await pen(page, cdp, line(676, 580, 850, 494, -10));
    await pen(page, cdp, ellipse(880, 470, 38, 38, 150, 362));
    await pen(page, cdp, ellipse(470, 290, 12, 12, 0, 362), { speed: 300 });
    await pen(page, cdp, ellipse(555, 290, 12, 12, 0, 362), { speed: 300 });
    await S('setColor', '#ffd23f');
    await S('fillAt', 512, 340);
    await S('setColor', '#3aa7e8');
    await S('fillAt', 512, 620);
    await S('setColor', '#e8443a');
    await S('fillAt', 880, 470);
    await S('setColor', '#7cc95a');
    await S('fillAt', 760, 515);
    await settle(page);
    await shot(page, 'tools-robot.png');
    const hashLines0 = await A('hash', lines);
    const hashColors0 = await A('hash', colors);

    // Lasso the arm: it lifts the lines and the colours together.
    await S('setTool', 'lasso');
    await drag(page, cdp, [[700, 400], [950, 400], [950, 540], [700, 640], [690, 520], [700, 400]], 60);
    const sel = await S('selection');
    out.lasso = { floating: sel?.floating ?? false, layers: sel?.layers.map((id) => (id === lines ? 'lines' : id === colors ? 'colors' : id)) ?? [], box: sel?.box };
    // Drag inside to move, a corner to scale, the round handle to rotate.
    const zoom = (await S('view')).zoom;
    let h = handles(sel, zoom);
    await drag(page, cdp, [[h.center.x, h.center.y], [h.center.x - 30, h.center.y + 40]], 20);
    let info = await S('selection');
    h = handles(info, zoom);
    const br = h.corners[2];
    await drag(page, cdp, [[br.x, br.y], [h.center.x + (br.x - h.center.x) * 1.25, h.center.y + (br.y - h.center.y) * 1.25]], 20);
    info = await S('selection');
    h = handles(info, zoom);
    const r = Math.hypot(h.rotate.x - h.center.x, h.rotate.y - h.center.y);
    const a0 = Math.atan2(h.rotate.y - h.center.y, h.rotate.x - h.center.x);
    await sendStroke(page, cdp, arc(h.center, r, a0, a0 - (Math.PI * 29) / 180), { kind: 'mouse', hz: 120 });
    info = await S('selection');
    out.transform = { tx: Math.round(info.transform.tx), ty: Math.round(info.transform.ty), scale: +info.transform.sx.toFixed(3), rotDeg: +((info.transform.rot * 180) / Math.PI).toFixed(2) };
    await S('flipSelection', 'h');
    out.flipped = (await S('selection')).transform.sx < 0;
    await S('flipSelection', 'h');
    await sleep(100);
    await shot(page, 'tools-select-floating.png');

    // Make this a part: one merged piece (lines + colours) on a new part layer above the lines.
    const part = await S('selectionToPart', 'arm');
    await sleep(50);
    const layers = await S('layers');
    const partInfo = layers.find((l) => l.id === part);
    out.part = {
      role: partInfo?.role,
      index: layers.findIndex((l) => l.id === part),
      aboveLines: layers.findIndex((l) => l.id === part) > layers.findIndex((l) => l.id === lines),
      pixels: Math.round(await A('coverage', part, 600, 300, 424, 400)),
      linesLeftBehind: Math.round(await A('coverage', lines, 700, 400, 250, 150)),
      colorsLeftBehind: Math.round(await A('coverage', colors, 700, 400, 250, 150)),
      history: (await S('historyState')).undoLabel,
    };
    out.checkPart = await A('checkView');
    await shot(page, 'tools-part.png');
    await S('undo');
    out.undoPart = { lines: (await A('hash', lines)) === hashLines0, colors: (await A('hash', colors)) === hashColors0, layers: (await S('layers')).length };
    await S('redo');
    out.redoPart = { layers: (await S('layers')).length, part: (await S('layers')).some((l) => l.role === 'part:arm') };
    await S('undo');

    // Box select the head, nudge it up with the arrow keys, Enter puts it down.
    await S('setActiveLayer', lines);
    await S('setTool', 'select');
    await drag(page, cdp, [[395, 185], [630, 405]], 20);
    await page.focus('#desk');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowUp');
    const nudged = await S('selection');
    await page.keyboard.press('Enter');
    await sleep(50);
    out.keys = { ty: nudged?.transform.ty ?? null, layers: nudged?.layers.length ?? 0, committed: (await S('selection')) === null };
    out.checkKeys = await A('checkView');

    // Scope 'layer': only the active layer moves.
    await S('setSelect', { scope: 'layer' });
    await S('setTool', 'lasso');
    await drag(page, cdp, [[330, 420], [700, 420], [700, 790], [330, 790], [330, 420]], 40);
    out.scopeLayer = (await S('selection'))?.layers.map((id) => (id === lines ? 'lines' : id === colors ? 'colors' : id)) ?? [];
    await S('cancelSelection');
    await S('setSelect', { scope: 'drawing' });
    out.cancelRestored = (await A('checkView')).bad === 0;

    // Eyedropper: picks the displayed colour.
    await S('setTool', 'eyedropper');
    const picked = page.evaluate(() => new Promise((r) => window.__art.surface.on('color', (c) => r(c.color))));
    await tap(page, cdp, 512, 640);
    out.eyedropper = await picked;
    saveJson(out, 'tools.json');
  } finally {
    await browser.close();
  }
}

async function flipbook() {
  const { browser, page, cdp } = await launch({ query: 'w=600&h=600' });
  const S = (f, ...a) => page.evaluate(([f, a]) => window.__art.surface[f](...a), [f, a]);
  try {
    await S('setBrush', { size: 6 });
    const ball = async (cx, cy, rx, ry, color) => {
      await S('setTool', 'ink');
      await pen(page, cdp, ellipse(cx, cy, rx, ry, -90, 362), { speed: 500 });
      await S('setColor', color);
      await S('fillAt', cx, cy);
      await S('setColor', '#2b1d16');
    };
    await ball(130, 140, 50, 50, '#e8443a');
    const f2 = await S('addFrame');
    await S('setOnion', { enabled: true, range: 1 });
    await ball(300, 300, 50, 50, '#f5a142');
    const f3 = await S('addFrame');
    await ball(470, 500, 62, 40, '#ffd23f');
    await settle(page);
    await S('setActiveFrame', f2);
    await sleep(100);
    await shot(page, 'tools-onion.png');
    await S('setFrameHold', f3, 2);
    const frames = await S('frames');
    const seen = await page.evaluate(async () => {
      const got = [];
      const stop = await window.__art.surface.playFrames(8, (i) => got.push(i));
      await new Promise((r) => setTimeout(r, 1100));
      stop();
      return got;
    });
    const ex = await page.evaluate(async () => {
      const e = await window.__art.surface.exportFrames();
      return e && { box: e.box, frames: e.frames.map((f) => ({ hold: f.hold, bytes: f.png.size })) };
    });
    out.flipbook = { frames: frames.map((f) => f.hold), played: seen.join(''), export: ex };
    await S('setOnion', { enabled: false });
    saveJson(out, 'tools.json');
  } finally {
    await browser.close();
  }
}

async function guideTrace() {
  const { browser, page, cdp } = await launch({});
  const S = (f, ...a) => page.evaluate(([f, a]) => window.__art.surface[f](...a), [f, a]);
  try {
    await S('setBrush', { size: 7 });
    await pen(page, cdp, ellipse(512, 330, 80, 80, -90, 362));
    await pen(page, cdp, line(512, 410, 512, 700));
    await pen(page, cdp, line(512, 700, 440, 890));
    await pen(page, cdp, line(512, 700, 590, 890));
    await pen(page, cdp, line(512, 500, 400, 600));
    await pen(page, cdp, line(512, 500, 630, 590));
    const flat = () => page.evaluate(async () => (await window.__art.exportArt()).flat);
    const before = await flat();
    await page.evaluate(async () => {
      // A gingerbread silhouette and a smaller hero for size.
      const shape = (w, h) => {
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext('2d');
        g.fillStyle = '#000';
        g.beginPath();
        g.arc(w / 2, h * 0.16, h * 0.14, 0, Math.PI * 2);
        g.roundRect(w * 0.28, h * 0.3, w * 0.44, h * 0.38, 20);
        g.roundRect(w * 0.05, h * 0.32, w * 0.9, h * 0.1, 20);
        g.roundRect(w * 0.3, h * 0.64, w * 0.15, h * 0.34, 16);
        g.roundRect(w * 0.55, h * 0.64, w * 0.15, h * 0.34, 16);
        g.fill();
        return c.transferToImageBitmap();
      };
      const sil = shape(400, 640);
      const hero = shape(200, 320);
      window.__art.surface.setGuide({
        silhouette: { image: sil, box: { x: 312, y: 250, w: 400, h: 640 }, opacity: 0.22, tint: '#7ea6f5' },
        sizeRef: { image: hero, box: { x: 70, y: 570, w: 200, h: 320 }, opacity: 0.3, tint: '#7ea6f5', label: 'Pip, for size' },
        groundY: 890,
        showAnchor: true,
      });
    });
    await sleep(150);
    await shot(page, 'tools-guide.png');
    const withGuide = await flat();
    // A photo to trace: 30%, locked, never exported.
    const traceId = await page.evaluate(async () => {
      const c = new OffscreenCanvas(800, 600);
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 800, 600);
      grad.addColorStop(0, '#3a6ea5');
      grad.addColorStop(1, '#f2c9a0');
      g.fillStyle = grad;
      g.fillRect(0, 0, 800, 600);
      g.fillStyle = '#2f5d34';
      g.beginPath();
      g.ellipse(400, 380, 220, 160, 0, 0, Math.PI * 2);
      g.fill();
      return window.__art.surface.importTrace(await c.convertToBlob());
    });
    await sleep(150);
    await shot(page, 'tools-trace.png');
    const trace = (await S('layers')).find((l) => l.id === traceId);
    const withTrace = await flat();
    await S('undo');
    const traceGone = !(await S('layers')).some((l) => l.id === traceId);
    await S('redo');
    const traceBack = (await S('layers')).some((l) => l.id === traceId);
    await S('setGuide', null);
    const anchor = await S('anchor');
    out.guide = { exportUnchanged: withGuide === before, anchor };
    out.trace = { role: trace?.role, opacity: trace?.opacity, locked: trace?.locked, exported: trace?.exported, exportUnchanged: withTrace === before, undo: traceGone, redo: traceBack };
    saveJson(out, 'tools.json');
  } finally {
    await browser.close();
  }
}

await selectionPart();
await flipbook();
await guideTrace();
console.log(JSON.stringify(out, null, 1));
