// Gap-closing fill on sketchy pen line art: taps through the real input path (Fill tool), a tap on a
// line, two inner regions touching through a gap (a face inside a helmet), a naive fill for comparison,
// and a background tap that must not bleed into any shape.
import { launch, humanStroke, sendStroke, ellipse, through, polyline, shot, saveJson, tap, settle, sleep } from './lib.mjs';

const { browser, page, cdp } = await launch({ query: 'perf=1' });
const S = (f, ...a) => page.evaluate(([f, a]) => window.__art.surface[f](...a), [f, a]);
const A = (f, ...a) => page.evaluate(([f, a]) => window.__art[f](...a), [f, a]);
let seed = 7;
const draw = (path, o = {}) => sendStroke(page, cdp, humanStroke(path, { seed: seed++, ...o }));
const out = { fills: [] };
const colors = ['#f5a142', '#7cc95a', '#3aa7e8', '#ff8fa3', '#ffd23f', '#8e5ad6', '#e8443a', '#2fa36b'];

try {
  await S('setTool', 'ink');
  await S('setColor', '#2b1d16');
  await S('setBrush', { size: 8 });
  // 1. Circle whose tapered ends stop ~7 px apart.
  await draw(ellipse(200, 200, 110, 110, -80, 350), { speed: 700 });
  // 2. Square with overshooting corners and an ~8 px gap at one corner.
  await draw(polyline([[420, 90], [640, 96], [636, 318], [412, 314], [416, 104]]), { speed: 750 });
  // 3. A blob with a ~16 px gap.
  await draw(through([[800, 110], [930, 140], [960, 250], [880, 330], [770, 300], [742, 200], [786, 124]]), { speed: 700 });
  // 4. A scribbly cloud of overlapping arcs (closed).
  for (const [cx, cy, r, a0, s] of [
    [160, 520, 70, 90, 200],
    [240, 450, 80, 160, 190],
    [340, 490, 70, 230, 200],
    [300, 590, 80, 330, 190],
    [190, 610, 70, 20, 190],
  ])
    await draw(ellipse(cx, cy, r, r * 0.8, a0, s), { speed: 650 });
  // 5. A helmet (closed) with a face inside it that has a gap: two inner regions touching through it.
  await draw(ellipse(640, 560, 170, 170, 90, 362), { speed: 800 });
  await draw(ellipse(640, 585, 95, 100, 200, 348), { speed: 650 });
  // 6. A heart for the tap-on-the-line test.
  await draw(through([[850, 700], [800, 640], [850, 600], [900, 640], [850, 700]]), { speed: 500 });
  await draw(through([[850, 700], [800, 640]]), { speed: 400 });
  await sleep(500);
  await shot(page, 'fill-lines.png');

  // Naive fill first (gaps off): the circle leaks into the page.
  await S('setTool', 'fill');
  await S('setFill', { gaps: 'off' });
  await S('setColor', '#f5a142');
  await tap(page, cdp, 200, 200);
  await settle(page);
  const naive = (await A('stats')).fills.at(-1);
  await shot(page, 'fill-naive.png');
  await S('undo');
  await settle(page);
  await sleep(100);

  // Gap closing: each shape fills inside only.
  await S('setFill', { gaps: 'auto' });
  const taps = [
    ['circle (7 px gap)', 200, 200],
    ['square (8 px gap)', 520, 200],
    ['blob (16 px gap)', 860, 230],
    ['cloud (closed)', 250, 530],
    ['helmet glass (inner split)', 640, 420],
    ['face (inner split)', 640, 600],
    ['heart, tap on its line', 850, 603],
  ];
  for (let i = 0; i < taps.length; i++) {
    const [name, x, y] = taps[i];
    await S('setColor', colors[i % colors.length]);
    await tap(page, cdp, x, y);
    await settle(page);
    const f = (await A('stats')).fills.at(-1);
    out.fills.push({ name, ...f, ms: Math.round(f.ms), analyzeMs: Math.round(f.analyzeMs) });
  }
  // Background last: never bleeds into the shapes.
  await S('setColor', '#dfe9f5');
  await tap(page, cdp, 40, 980);
  await settle(page);
  const bg = (await A('stats')).fills.at(-1);
  out.fills.push({ name: 'background', ...bg, ms: Math.round(bg.ms), analyzeMs: Math.round(bg.analyzeMs) });
  // Checks: a pixel inside each shape has its colour; the blob's inside is not the background colour.
  const colorsLayer = await A('layerId', 'colors');
  out.checks = {
    circleInside: await A('pixel', colorsLayer, 200, 200),
    circleOutsideGap: await A('pixel', colorsLayer, 200 + 120 * Math.cos((-85 * Math.PI) / 180), 200 + 120 * Math.sin((-85 * Math.PI) / 180)),
    glass: await A('pixel', colorsLayer, 640, 420),
    face: await A('pixel', colorsLayer, 640, 600),
    blobInside: await A('pixel', colorsLayer, 860, 230),
  };
  out.naive = { background: naive.background, area: naive.area };
  await shot(page, 'fill-auto.png');
  await page.evaluate(() => window.__art.look(4, 0, 200, 92));
  await shot(page, 'fill-4x-gap.png');
  await page.evaluate(() => window.__art.look(3, 0, 850, 610));
  await shot(page, 'fill-3x-tap-on-line.png');
  await page.evaluate(() => window.__art.look(1.6, 0, 640, 560));
  await shot(page, 'fill-inner-regions.png');
  saveJson(out, 'fill.json');
  console.log(JSON.stringify(out, null, 1));
} finally {
  await browser.close();
}
