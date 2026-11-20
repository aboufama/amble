import { chromium } from '@playwright/test';
const [out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => window === window.top && localStorage.setItem('amble:start', 'seen'));
const p = await ctx.newPage();
await p.goto('http://localhost:5210', { timeout: 120000 });
await p.waitForSelector('.blocklyMainBackground', { timeout: 120000 });
await p.evaluate(async () => {
  const json = await (await fetch('/bench/results-harness/v23-r3/openai__gpt-6.2-sol/countdown-chickens.amble')).json();
  const { migrateProject } = await import('/src/project/migrate.ts');
  const { closeSvg } = await import('/src/compiler/sketch.ts');
  const { oneLine, topBlocks } = await import('/src/compiler/serialize.ts');
  const store = window.__ambleStore;
  store.getState().closeHome();
  const proj = migrateProject(json);
  store.getState().setProject(proj);
  await new Promise((r) => setTimeout(r, 1000));
  const svgOf = (a) => decodeURIComponent(escape(atob(a.dataUrl.split(',')[1])));
  const drawings = [];
  const seen = [];
  for (const a of proj.compiled.assets.filter((x) => x.kind === 'image')) {
    const isBackdrop = a.targetName === 'Stage';
    if (!isBackdrop && seen.includes(a.targetName)) continue;
    if (isBackdrop && drawings.some((d) => d.kind === 'backdrop')) continue;
    if (!isBackdrop) seen.push(a.targetName);
    const svg = svgOf(a);
    const cut = !isBackdrop && seen.length >= 4;
    drawings.push({ target: a.targetName, name: a.name, kind: isBackdrop ? 'backdrop' : 'costume', svg: cut ? closeSvg(svg.slice(0, Math.floor(svg.length * (seen.length === 4 ? 0.55 : 0.3)))) || svg : svg, done: !cut });
  }
  const words = oneLine(topBlocks(proj.stage.blocks).find((b) => b.type === 'br_game').fields.WHAT);
  store.getState().setCompile({ status: 'running', forPlay: true, building: [{ targetId: proj.stage.id, words }], progress: { stage: 'writing', message: 'Compiling', preview: { title: proj.compiled.title, howToPlay: proj.compiled.howToPlay, drawings } } });
});
await p.waitForTimeout(1600);
await (await p.$('.making-game')).screenshot({ path: out, animations: 'disabled' });
await browser.close();
console.log('ok');
