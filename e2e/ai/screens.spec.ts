/**
 * Every state of the wish box (§2.8 as MAGIC-BRIEF.md reshapes it) at 1366x768, in Original colours and
 * High contrast: axe on each state, and screenshots when `AI_SHOTS=<dir>` is set
 * (`AI_SHOTS=/tmp/shots npx playwright test e2e/ai/screens.spec.ts`). A real wish goes through the mock
 * endpoint (working, the "Done!" toast, See what changed); the other states are set straight in the store,
 * so each one is exact and quick. The flows themselves are the other ai-* specs.
 *
 * Screenshots hide two things other parts of the app still draw and are removing too (MAGIC-BRIEF.md):
 * the top bar's AI chip and the panel's AI HELPER badge. Axe never looks at them here. In High contrast
 * the page also gets the black `--surface` the theme is missing (src/ui/themes.css only swaps
 * --surface-top/-bottom/-raised since the Scratch look made --surface a plain white), or every panel,
 * the wish box's among them, would be white with white words.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openAmble, test } from '../helpers/app';
import { mockAi } from '../helpers/mockAi';
import { mountHarness, openFixtureWorld, outcomeOf, pauseGame, unmountHarness, type AmbleWindow } from './harness';

const OUT = process.env.AI_SHOTS;

type Patch = Record<string, unknown>;

async function setAi(page: Page, patch: Patch): Promise<void> {
  await page.evaluate((p) => {
    (window as unknown as AmbleWindow).__amble.setState((s) => {
      Object.assign(s.ai, p);
    });
  }, patch);
}

async function reset(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await setAi(page, { job: null, lastOutcome: null, outcomeFor: null, wait: null, steer: null, landed: null, changed: null, status: 'ready' });
  await page.getByTestId('ai-field').fill('');
}

/** WCAG 2.1 A and AA problems in the wish box, its toast and any open dialog (the game frames are canvases). */
async function axe(page: Page, where: string): Promise<string[]> {
  const scope = await page.evaluate(() => {
    const found: string[] = [];
    if (document.querySelector('[data-testid="ask-card"]')) found.push('[data-testid="ask-card"]');
    if (document.querySelector('.wish-toast-host')) found.push('.wish-toast-host');
    if (document.querySelector('dialog[open]')) found.push('dialog[open]');
    if (document.querySelector('[data-testid="ai-build-pill"]')) found.push('[data-testid="ai-build-pill"]');
    if (document.querySelector('[data-testid="ai-sent"]')) found.push('[data-testid="ai-sent"]');
    return found;
  });
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('iframe');
  for (const s of scope) builder = builder.include(s);
  const r = await builder.analyze();
  return r.violations.map((v) => `${where} → ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

for (const theme of ['original', 'contrast'] as const) {
  test(`the wish box in every state, ${theme} colours`, async ({ page }) => {
    test.setTimeout(360_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await mockAi(page, { patches: ['change-stomp.patch'], firstByteDelayMs: 2500 });
    await openAmble(page, { ai: 'mock', clean: true, prefs: { theme: theme === 'contrast' ? 'contrast' : 'night', uiSounds: 'off' } });
    const id = await openFixtureWorld(page);
    await pauseGame(page);
    await mountHarness(page);
    await page.addStyleTag({ content: `[data-testid="ai-chip"], .ask-card__badge { display: none !important; } :root[data-theme='contrast'] { --surface: #000000; }` });

    const found: string[] = [];
    const shot = async (name: string, o: { axe?: boolean } = {}) => {
      if (o.axe !== false) found.push(...(await axe(page, name)));
      if (!OUT) return;
      // Let entrances settle (the wish toast rises in 360 ms).
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${theme}/${name}.png`, animations: 'disabled' });
    };
    const now = await page.evaluate(() => Date.now());
    const outcomeFor = (task = 'change', request = 'make the moon king throw fireballs') => ({ worldId: id, task, request, at: now });
    const manifest = await page.evaluate(() => (window as unknown as AmbleWindow).__amble.getState().session.manifest);
    const field = page.getByTestId('ai-field');

    // Idle, typing, private info.
    await expect(page.getByTestId('ai-ask')).toHaveAttribute('data-state', 'idle');
    await shot('01-idle');
    await field.fill('make the moon king throw fireballs');
    await shot('02-typing');
    await field.fill('my name is Sam and my phone is 603-555-0199');
    await expect(page.getByTestId('ai-pii')).toBeVisible();
    await shot('03-private-info');
    await field.fill('');

    // A real wish: working, then the "Done!" toast over the world, then See what changed.
    await field.fill('let me stomp on the minions');
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('ai-progress')).toBeVisible();
    await shot('04-working');
    expect(await outcomeOf(page, id)).toBe('accepted');
    const done = page.getByTestId('wish-done');
    await expect(done).toBeVisible();
    await shot('05-done-toast');
    await done.getByRole('button', { name: 'See what changed' }).click();
    await expect(page.getByTestId('diff-sheet')).toBeVisible();
    // The sheet is Footsteps' own (its scroller needs to take focus: axe's scrollable-region-focusable).
    await shot('06-see-what-changed', { axe: false });
    await reset(page);

    // Waiting its turn.
    const job = (progress: Patch) => ({ worldId: id, task: 'change', request: 'Make the Moon King get angrier when he is hurt', progress, startedAt: now });
    await setAi(page, { job: job({ phase: 'queued', waitMs: 20_000 }), wait: { worldId: id, reason: 'rate-limited', until: Date.now() + 20_000 } });
    await expect(page.getByTestId('ai-wait')).toBeVisible();
    await shot('07-queued');
    await reset(page);

    // Refused on the device, with its kind alternatives.
    await field.fill('make the boss look like my teacher Mr Smith and beat him up');
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('ai-refusal')).toBeVisible();
    await shot('08-refusal');
    await reset(page);

    // A wish that didn't work, with the details for the curious.
    await setAi(page, {
      lastOutcome: { kind: 'failed', reason: 'runtime', message: "That wish didn't work this time. Your world is just like before.", details: ["boss.js line 3: Cannot read properties of undefined (reading 'amount')"] },
      outcomeFor: outcomeFor(),
    });
    await page.getByRole('button', { name: 'Details' }).click();
    await shot('09-failed');
    await reset(page);

    // What a landed wish still asks: a gentler version, a new member to draw, lines the student wrote.
    await setAi(page, {
      lastOutcome: {
        kind: 'accepted',
        files: [],
        manifest,
        summary: 'The Moon King stomps when he is angry.',
        play: '',
        next: ['Make the stomp bigger', 'Add falling rocks', 'Give Pip a shield'],
        safety: { kind: 'toned-down', note: 'the minions bounce off instead of getting hurt.' },
        repairs: 0,
        tested: true,
        handEditsTouched: true,
        newArt: ['minion'],
      },
      outcomeFor: outcomeFor(),
      changed: { worldId: id, files: ['boss.js'], handFile: 'boss.js' },
    });
    await shot('10-done-notes');
    await reset(page);

    // The crisis card (its words never change).
    await field.fill('nobody would care if i died');
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('ai-crisis')).toBeVisible();
    await shot('11-crisis');
    await page.getByRole('dialog').getByRole('button', { name: 'Back to my world' }).click();

    // A dial the device turned.
    await field.fill('make the jump higher');
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('ai-steer')).toBeVisible();
    await shot('12-steer-toast');
    await reset(page);

    // How wishes work (only when asked).
    await page.getByTestId('wish-how').click();
    await expect(page.getByTestId('ai-explainer')).toBeVisible();
    await shot('13-how-wishes-work');
    await page.getByRole('dialog').getByRole('button', { name: 'Got it' }).click();

    // When wishes rest: one quiet line.
    for (const status of ['off', 'offline', 'blocked', 'quota', 'expired', 'rejected', 'busy', 'explain-only'] as const) {
      await setAi(page, { status });
      await expect(page.getByTestId('ai-status')).toBeVisible();
      await expect(page.getByTestId('ai-field')).toHaveCount(0);
      await shot(`14-resting-${status}`);
    }
    await setAi(page, { status: 'ready' });

    // The build pill on the Desk, building and ready.
    await setAi(page, { job: { worldId: id, task: 'build', request: 'Help Shelly rescue her friends', progress: { phase: 'writing', chars: 7400 }, startedAt: now } });
    await unmountHarness(page);
    await page.evaluate((w) => (window as unknown as AmbleWindow).__amble.navigate({ name: 'draw', worldId: w, key: 'minion' }), id);
    await expect(page.getByTestId('ai-build-pill')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await shot('15-build-pill');
    await setAi(page, {
      job: null,
      lastOutcome: { kind: 'accepted', files: [], manifest, summary: '', play: '', next: [], safety: { kind: 'ok', note: '' }, repairs: 0, tested: true, handEditsTouched: false, newArt: [] },
      outcomeFor: outcomeFor('build', 'Help Shelly rescue her friends'),
    });
    await expect(page.getByTestId('ai-build-pill')).toHaveAttribute('data-state', 'ready');
    await shot('16-build-ready');

    // What Amble sends (grown-ups; reached from How wishes work and Settings).
    await page.evaluate(async () => {
      const a = (window as unknown as AmbleWindow).__amble;
      const body = JSON.stringify({ model: 'test-model', store: false, stream: true, max_completion_tokens: 16000, messages: [{ role: 'system', content: '# ROLE…' }, { role: 'user', content: 'Task: change\nContent level: middle\n…' }] });
      await a.services.store.ailog.add({ id: 'g_shot000001', at: Date.now(), kind: 'change', host: 'ai.test', model: 'test-model', bytesSent: body.length, bytesReceived: 1830, included: ['your words', 'game.js (106 lines)', 'the list of drawings (no pictures)', 'the dial settings'], body, status: 'ok', replySummary: 'Changed game.js' });
    });
    await mountHarness(page, 'sent');
    await page.getByRole('button', { name: /^Show exactly/ }).first().click();
    await shot('17-whats-sent');

    expect(found).toEqual([]);
  });
}
