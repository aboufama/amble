#!/usr/bin/env node
/** Draws one costume, then a second costume from it (the follow-up path), and prints what happened. */
import { chromium } from '@playwright/test';

const model = process.argv[2] || 'openai/gpt-6.1-terra';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const page = await browser.newPage();
await page.addInitScript(() => window === window.top && localStorage.setItem('amble:start', 'seen'));
await page.goto('http://localhost:5199', { timeout: 240_000 });
await page.waitForSelector('.blocklyMainBackground', { timeout: 240_000 });
const out = await page.evaluate(async (model) => {
  const { generateAsset, referenceOf } = await import('/src/compiler/assets.ts');
  const { resolveTransport, DEFAULT_SETTINGS } = await import('/src/compiler/openai.ts');
  const { artBrief } = await import('/src/project/styles.ts');
  const settings = { ...DEFAULT_SETTINGS, model, assetModel: model, reasoningEffort: 'low' };
  const transport = await resolveTransport(settings);
  const ctx = { transport, settings, gameTitle: 'Cluck Test', style: artBrief('') };
  const job = { targetId: 's1', targetName: 'Hen', kind: 'costume', name: 'hen_walk1', description: 'a plump white hen mid-step, side view', width: 80, height: 80 };
  const log = [];
  let t = performance.now();
  const first = await generateAsset(job, ctx);
  log.push(`first: ${Math.round(performance.now() - t)} ms, ${first.dataUrl.length} chars`, decodeURIComponent(first.dataUrl.split(",")[1]).slice(0, 400));
  t = performance.now();
  try {
    const second = await generateAsset({ ...job, name: 'hen_walk2', description: 'the same hen, other foot forward', reference: referenceOf(first) }, ctx);
    log.push(`second: ${Math.round(performance.now() - t)} ms, ${second.dataUrl.length} chars`);
  } catch (e) {
    log.push(`second FAILED after ${Math.round(performance.now() - t)} ms: ${e.message}`);
  }
  return log;
}, model);
console.log(out.join('\n'));
await browser.close();
