// Hold to perfect (line, circle, ellipse, triangle, rectangle), "make it perfect", mirror (2- and 4-way),
// two-finger tap undo / three-finger tap redo, pinch-rotate, and palm rejection.
import { launch, humanStroke, sendStroke, ellipse, line, polyline, through, shot, saveJson, fingerTap, pinch, sleep, settle } from './lib.mjs';

const { browser, page, cdp } = await launch({});
const S = (f, ...a) => page.evaluate(([f, a]) => window.__art.surface[f](...a), [f, a]);
const A = (f, ...a) => page.evaluate(([f, a]) => window.__art[f](...a), [f, a]);
let seed = 40;
const out = { perfect: [], taps: {}, gesture: {} };
await page.evaluate(() => {
  window.__toasts = [];
  window.__art.surface.on('toast', (t) => window.__toasts.push(t));
});
const lastToast = () => page.evaluate(() => window.__toasts.at(-1) ?? null);
// A wobbly stroke that ends resting still for ~0.6 s (hold samples send no movement).
const hold = (path, o = {}) => sendStroke(page, cdp, humanStroke(path, { seed: seed++, speed: 600, wobble: 3, tremor: 0.6, hold: 150, ...o }));

try {
  await S('setTool', 'ink');
  await S('setColor', '#2b1d16');
  await S('setBrush', { size: 7 });
  const cases = [
    ['line', line(80, 120, 420, 180, 6)],
    ['circle', ellipse(250, 380, 120, 116, -100, 358)],
    ['ellipse', ellipse(700, 150, 190, 90, 180, 358)],
    ['triangle', polyline([[560, 520], [700, 300], [860, 520], [562, 516]])],
    ['rectangle', polyline([[120, 620], [420, 626], [416, 880], [114, 872], [122, 622]])],
  ];
  for (const [want, path] of cases) {
    await hold(path);
    const t = await lastToast();
    out.perfect.push({ want, got: t?.shape ?? null });
    await page.evaluate(() => (window.__toasts = []));
  }
  // "Make it perfect" without holding (timing-free).
  await sendStroke(page, cdp, humanStroke(ellipse(700, 760, 110, 110, 90, 356), { seed: seed++, speed: 600, wobble: 3, tremor: 0.6 }));
  out.button = await S('makeLastStrokePerfect');
  await sleep(100);
  await shot(page, 'shapes-perfect.png');
  await page.evaluate(() => window.__art.look(3, 0, 250, 270));
  await shot(page, 'shapes-3x-circle.png');
  await S('fit');

  // Undo with a two-finger tap, redo with three.
  const before = await A('hash', await A('layerId', 'lines'));
  await fingerTap(cdp, 2);
  await settle(page);
  const afterUndo = await A('hash', await A('layerId', 'lines'));
  await fingerTap(cdp, 3);
  await settle(page);
  const afterRedo = await A('hash', await A('layerId', 'lines'));
  out.taps = { undoChanged: afterUndo !== before, redoRestored: afterRedo === before };

  // Pinch and rotate with two fingers (CSS transform during, crisp redraw after).
  const v0 = await S('view');
  await pinch(cdp, { scale: 1.5, deg: 25 });
  const v1 = await S('view');
  out.gesture = { zoom: [v0.zoom, v1.zoom], rotDeg: Math.round((v1.rot * 180) / Math.PI), transformCleared: await page.evaluate(() => document.querySelector('#desk canvas').style.transform === '') };
  await shot(page, 'shapes-pinch-rotate.png');
  // Rotation snaps upright when close.
  await S('setRotation', (4 * Math.PI) / 180);
  out.gesture.snapped = (await S('view')).rot;
  await S('fit');

  // Mirror: a butterfly drawn on one side, and a 4-way flower.
  await S('clearLayer');
  await S('setMirror', { x: true });
  await S('setColor', '#3d5bd9');
  await sendStroke(page, cdp, humanStroke(through([[508, 300], [420, 200], [300, 190], [260, 290], [330, 370], [470, 400], [506, 420]]), { seed: seed++, speed: 700 }));
  await sendStroke(page, cdp, humanStroke(through([[506, 430], [420, 470], [340, 560], [380, 620], [470, 580], [507, 500]]), { seed: seed++, speed: 700 }));
  await S('setMirror', { x: true, y: 800 });
  await S('setColor', '#e8443a');
  await sendStroke(page, cdp, humanStroke(through([[512, 800], [440, 740], [420, 690], [470, 690], [512, 800]]), { seed: seed++, speed: 500 }));
  await S('setMirror', null);
  await shot(page, 'shapes-mirror.png');
  out.mirror = {
    // The wing's top edge crosses this box; its mirror image must cover the same amount.
    left: Math.round(await A('coverage', await A('layerId', 'lines'), 340, 160, 40, 60)),
    right: Math.round(await A('coverage', await A('layerId', 'lines'), 1024 - 380, 160, 40, 60)),
    // A flower petal and its reflection below the y = 800 mirror line.
    petalAbove: Math.round(await A('coverage', await A('layerId', 'lines'), 410, 680, 40, 60)),
    petalBelow: Math.round(await A('coverage', await A('layerId', 'lines'), 410, 1600 - 740, 40, 60)),
  };

  // Palm rejection: after a pen, a single finger pans instead of drawing.
  const hashPen = await A('hash', await A('layerId', 'lines'));
  const vPan0 = await S('view');
  await sendStroke(page, cdp, humanStroke(line(300, 900, 700, 900), { seed: seed++, speed: 900 }), { kind: 'touch' });
  const vPan1 = await S('view');
  out.palm = { pixelsUnchanged: (await A('hash', await A('layerId', 'lines'))) === hashPen, panned: Math.round(vPan1.panX - vPan0.panX) };
  saveJson(out, 'shapes.json');
  console.log(JSON.stringify(out, null, 1));
} finally {
  await browser.close();
}
