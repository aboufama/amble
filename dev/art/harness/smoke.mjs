// Every brush once, a fill, undo/redo, then screenshots (fit and close-ups).
import { launch, humanStroke, sendStroke, ellipse, line, shot, tap } from './lib.mjs';

const { browser, page, cdp } = await launch({ query: 'perf=1' });
const A = (f, ...a) => page.evaluate(([f, a]) => window.__art.surface[f](...a), [f, a]);
let seed = 1;
const draw = (path, o = {}, kind = 'pen') => sendStroke(page, cdp, humanStroke(path, { seed: seed++, ...o }), { kind });
try {
  const brushes = ['ink', 'pencil', 'marker', 'crayon', 'airbrush', 'eraser'];
  await A('setColor', '#2b1d16');
  for (let i = 0; i < brushes.length; i++) {
    await A('setTool', brushes[i]);
    const y = 140 + i * 130;
    await draw(line(120, y, 900, y + 30, 25), { speed: 900 });
  }
  await A('setTool', 'ink');
  await A('setBrush', { size: 9 });
  await draw(ellipse(512, 512, 180, 150, 90, 350), { speed: 700 });
  await A('setTool', 'fill');
  await A('setColor', '#f5a142');
  await tap(page, cdp, 512, 512);
  await page.waitForTimeout(400);
  await A('setTool', 'ink');
  await draw(line(300, 900, 700, 900, 0), { speed: 800 }, 'mouse');
  await draw(line(300, 950, 700, 950, 0), { speed: 800 }, 'touch');
  console.log('history', JSON.stringify(await A('historyState')));
  await A('undo');
  await A('redo');
  await shot(page, 'smoke-fit.png');
  await page.evaluate(() => window.__art.look(3, 0, 300, 160));
  await shot(page, 'smoke-3x-ink.png');
  await page.evaluate(() => window.__art.look(3, 0, 300, 290));
  await shot(page, 'smoke-3x-pencil.png');
  await page.evaluate(() => window.__art.look(3, 0, 330, 540));
  await shot(page, 'smoke-3x-crayon.png');
  console.log('stats', JSON.stringify(await page.evaluate(() => window.__art.stats())));
} finally {
  await browser.close();
}
