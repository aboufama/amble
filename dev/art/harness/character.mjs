// Draws "Pip", a kid-style dragon, with scripted pen input (240 Hz, pressure, tilt, human wobble and
// tremor): line art with mirror symmetry, fills under the lines (one closing a sketchy gap), crayon belly
// plates, airbrush cheeks, pencil hatching and a marker shadow on a multiply layer, white highlights.
// Then screenshots at 1x and 3x, and the export (flat PNG with anchor, layer PNGs, ink mask).
import { launch, humanStroke, sendStroke, ellipse, line, through, polyline, shot, saveDataUrl, saveJson, tap, sleep } from './lib.mjs';

const { browser, page, cdp } = await launch({ query: 'perf=1' });
const S = (f, ...a) => page.evaluate(([f, a]) => window.__art.surface[f](...a), [f, a]);
const A = (f, ...a) => page.evaluate(([f, a]) => window.__art[f](...a), [f, a]);
let seed = 100;
const draw = (path, o = {}) => sendStroke(page, cdp, humanStroke(path, { seed: seed++, ...o }));
const log = { fills: [], toasts: [] };
page.on('console', (m) => {
  if (m.text().startsWith('[toast]')) log.toasts.push(m.text());
});
await page.evaluate(() => window.__art.surface.on('toast', (t) => console.log('[toast]', t.message)));

const INK = '#2b1d16';
try {
  const shading = await S('addLayer', 'paint', { name: 'Shading', blend: 'multiply' });
  const lines = await A('layerId', 'lines');
  const colors = await A('layerId', 'colors');
  await S('setActiveLayer', lines);

  // ---------------- line art
  await S('setTool', 'ink');
  await S('setColor', INK);
  await S('setBrush', { size: 8.5 });
  // Head: two strokes that leave a small sketchy gap at the top.
  await draw(ellipse(512, 360, 176, 150, 276, 184), { speed: 780 });
  await draw(ellipse(512, 360, 176, 150, 272, -192), { speed: 780 });
  await S('setMirror', { x: true });
  // Horns (mirrored).
  await draw(through([[412, 242], [392, 192], [398, 138], [428, 176], [452, 221]]), { speed: 520 });
  // Eyes and pupils (mirrored).
  await draw(ellipse(445, 345, 40, 48, 250, 372), { speed: 420 });
  await draw(ellipse(455, 360, 20, 22, 250, 372), { speed: 300 });
  // Nostrils: taps make dots.
  await draw(ellipse(495, 414, 1.2, 1.2, 0, 360), { speed: 20, dur: 70, p0: 0.7, p1: 0.8, wobble: 0, tremor: 0, jitter: 0 });
  // Body side, arm, foot, wing (all mirrored).
  await draw(through([[425, 490], [400, 560], [386, 640], [395, 720], [425, 775], [470, 800]]), { speed: 820 });
  // The arm starts and ends on the body's outline, so it closes against it.
  await draw(through([[398, 566], [370, 582], [348, 610], [356, 636], [378, 636], [391, 616]]), { speed: 560 });
  await draw(ellipse(455, 814, 48, 26, 200, 365), { speed: 520 });
  await draw(polyline([[421, 500], [352, 438], [306, 440], [322, 478], [276, 500], [304, 530], [262, 556], [322, 572], [406, 546]]), { speed: 700 });
  await S('setMirror', null);
  await draw(through([[470, 800], [512, 806], [554, 800]]), { speed: 400 });
  // Smile, belly, tail and its spade tip.
  await draw(through([[462, 441], [487, 462], [512, 468], [537, 462], [562, 441]]), { speed: 420, p0: 0.3, p1: 0.8 });
  await draw(ellipse(512, 662, 70, 100, 265, 366), { speed: 650 });
  await draw(through([[630, 700], [700, 735], [760, 712], [792, 650], [786, 596], [818, 652], [806, 735], [732, 790], [640, 792], [606, 772]]), { speed: 820 });
  // A spade on the tail tip: two round lobes and a point.
  await draw(through([[786, 606], [760, 600], [748, 578], [764, 556], [792, 520], [820, 556], [834, 578], [822, 600], [796, 606]]), { speed: 420 });

  // ---------------- colours: fill under the lines
  await S('setActiveLayer', colors);
  await S('setTool', 'fill');
  const fill = async (color, x, y, name) => {
    await S('setColor', color);
    const t0 = Date.now();
    const ok = await S('fillAt', x, y);
    const st = await A('stats');
    const f = st.fills[st.fills.length - 1];
    log.fills.push({ name, ok, gap: f?.gap, background: f?.background, split: f?.split, ms: f && Math.round(f.ms), analyzeMs: f && Math.round(f.analyzeMs), wall: Date.now() - t0 });
  };
  const GREEN = '#7cc95a';
  await fill(GREEN, 512, 260, 'head');
  await fill(GREEN, 512, 536, 'body');
  await fill('#ffe9b0', 512, 662, 'belly');
  await fill('#fff1c9', 405, 185, 'left horn');
  await fill('#fff1c9', 619, 185, 'right horn');
  await fill('#ffffff', 428, 320, 'left eye');
  await fill('#ffffff', 596, 320, 'right eye');
  await fill(INK, 455, 360, 'left pupil');
  await fill(INK, 569, 360, 'right pupil');
  await fill(GREEN, 368, 614, 'left arm');
  await fill(GREEN, 656, 614, 'right arm');
  await fill(GREEN, 455, 818, 'left foot');
  await fill(GREEN, 569, 818, 'right foot');
  await fill('#b48ee0', 330, 500, 'left wing');
  await fill('#b48ee0', 694, 500, 'right wing');
  await fill(GREEN, 740, 755, 'tail');
  await fill('#f5a142', 793, 566, 'spade');

  // Crayon belly plates, airbrush cheeks.
  await S('setTool', 'crayon');
  await S('setColor', '#e2b65c');
  await S('setBrush', { size: 11 });
  for (const [y, hw] of [[606, 46], [644, 58], [684, 58], [722, 46]]) await draw(line(512 - hw, y, 512 + hw, y + 2, 4), { speed: 420, p0: 0.5, p1: 0.9 });
  await S('setTool', 'airbrush');
  await S('setColor', '#ff7a9a');
  await S('setBrush', { size: 62 });
  await draw(line(404, 428, 414, 424), { speed: 45 });
  await draw(line(610, 424, 620, 428), { speed: 45 });

  // ---------------- shading (multiply): pencil hatching and a marker ground shadow
  await S('setActiveLayer', shading);
  await S('setTool', 'pencil');
  await S('setColor', '#4f7a3a');
  await S('setBrush', { size: 3.6 });
  for (let i = 0; i < 10; i++) await draw(line(600 + i * 2.5, 590 + i * 16, 626 + i * 0.8, 568 + i * 16, 1.5), { speed: 900, p0: 0.35, p1: 0.75 });
  await S('setTool', 'marker');
  await S('setColor', '#9aa3c7');
  await S('setBrush', { size: 30 });
  await draw(through([[398, 852], [512, 860], [626, 852]]), { speed: 500 });

  // ---------------- highlights (white ink on the lines layer)
  await S('setActiveLayer', lines);
  await S('setTool', 'ink');
  await S('setColor', '#ffffff');
  await S('setMirror', { x: true });
  await S('setBrush', { size: 13 });
  await draw(ellipse(463, 347, 1.2, 1.2, 0, 360), { speed: 20, dur: 80, p0: 0.8, p1: 0.9, wobble: 0, tremor: 0, jitter: 0 });
  await S('setBrush', { size: 6 });
  await draw(ellipse(449, 371, 1, 1, 0, 360), { speed: 20, dur: 70, p0: 0.8, p1: 0.9, wobble: 0, tremor: 0, jitter: 0 });
  await S('setMirror', null);
  await S('setBrush', { size: 7 });
  await draw(ellipse(512, 360, 140, 118, 200, 38), { speed: 500, p0: 0.3, p1: 0.8 });
  await sleep(300);

  // ---------------- outputs
  log.stats = await A('stats');
  await page.screenshot({ path: `${(await import('./lib.mjs')).OUT}/character-ui.png` });
  await page.evaluate(() => window.__art.look(1, 0, 540, 520));
  await shot(page, 'character-1x.png');
  await page.evaluate(() => window.__art.look(3, 0, 512, 380));
  await shot(page, 'character-3x-face.png');
  await page.evaluate(() => window.__art.look(3, 0, 560, 700));
  await shot(page, 'character-3x-belly.png');
  await page.evaluate(() => window.__art.look(3, 0, 330, 520));
  await shot(page, 'character-3x-wing.png');
  await page.evaluate(() => window.__art.look(4, 0, 790, 610));
  await shot(page, 'character-4x-tail.png');
  await S('fit');
  const ex = await A('exportArt', {});
  saveDataUrl(ex.flat, 'character-art.png');
  for (const l of ex.layers) saveDataUrl(l.png, `character-layer-${l.name.toLowerCase()}.png`);
  if (ex.linesMask) saveDataUrl(ex.linesMask, 'character-lines-mask.png');
  saveDataUrl(ex.thumb, 'character-thumb.png');
  const saved = await A('saveDoc');
  log.export = { box: ex.box, anchor: ex.anchor, w: ex.w, h: ex.h, bytes: ex.bytes, layers: ex.layers.map((l) => ({ name: l.name, role: l.role, x: l.x, y: l.y, w: l.w, h: l.h, bytes: l.bytes })) };
  log.doc = { bytes: saved.bytes, cels: saved.cels, logBytes: saved.logBytes };
  saveJson(log, 'character.json');
  console.log(JSON.stringify({ fills: log.fills.map((f) => [f.name, f.gap, f.background, f.split, f.ms]), toasts: log.toasts, export: log.export, doc: log.doc, latency: log.stats.latency, work: log.stats.work, commit: log.stats.commit, history: log.stats.history }));
} finally {
  await browser.close();
}
