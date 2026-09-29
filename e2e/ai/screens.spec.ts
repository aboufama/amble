/**
 * Screenshots of every AI card state at 1366x768 and 1280x800 (§8.1's visual review), only when
 * `AI_SHOTS=<dir>` is set: `AI_SHOTS=/tmp/shots npx playwright test e2e/ai/screens.spec.ts`. States are set
 * straight in the store, so each one is exact and quick; the flows themselves are the other ai-* specs.
 */
import type { Page } from '@playwright/test';
import { expect, openAmble, test } from '../helpers/app';
import { mockAi } from '../helpers/mockAi';
import { mountHarness, openStarterWorld, pauseGame, type AmbleWindow } from './harness';

const OUT = process.env.AI_SHOTS;
test.skip(!OUT, 'screenshots only when AI_SHOTS is set');

type Patch = Record<string, unknown>;

async function setAi(page: Page, patch: Patch): Promise<void> {
  await page.evaluate((p) => {
    (window as unknown as AmbleWindow).__amble.setState((s) => {
      Object.assign(s.ai, p);
    });
  }, patch);
}

async function reset(page: Page, worldId: string): Promise<void> {
  await setAi(page, { job: null, lastOutcome: null, outcomeFor: null, wait: null, explainer: null, explain: null, explaining: null, steer: null, changed: null, status: 'ready' });
  await mountHarness(page);
  void worldId;
}

for (const [w, h] of [
  [1366, 768],
  [1280, 800],
] as const) {
  test(`the AI cards at ${w}x${h}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: w, height: h });
    await mockAi(page, { patches: [] });
    await openAmble(page, { ai: 'mock', clean: true });
    const id = await openStarterWorld(page);
    await pauseGame(page);
    await mountHarness(page);
    const shot = async (name: string) => {
      // Let transitions and the first countdown tick settle.
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/${name}-${w}x${h}.png`, animations: 'disabled' });
    };
    const now = await page.evaluate(() => Date.now());
    const outcomeFor = (task = 'change', request = 'make the moon king get angrier') => ({ worldId: id, task, request, at: now });

    // Idle, the explainer, personal info.
    await shot('01-idle');
    await setAi(page, { explainer: { worldId: id, words: 'make the boss throw pizza', scope: null } });
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot('02-explainer');
    await setAi(page, { explainer: null });
    await page.getByTestId('ai-field').fill('my name is Sam and my phone is 603-555-0199');
    await expect(page.getByTestId('ai-pii')).toBeVisible();
    await shot('03-personal-info');
    await page.getByTestId('ai-field').fill('');

    // Working: writing a file, fixing, and a busy wait.
    const job = (progress: Patch) => ({ worldId: id, task: 'change', request: 'Make the Moon King get angrier when he is hurt: faster orbs and a stomp', progress, startedAt: now });
    await setAi(page, { job: job({ phase: 'writing', file: 'boss.js', lines: 34, chars: 2100 }) });
    await shot('04-working-writing');
    await setAi(page, { job: job({ phase: 'fixing', round: 1 }) });
    await shot('05-working-fixing');
    await setAi(page, { job: job({ phase: 'queued', waitMs: 8000 }), wait: { worldId: id, reason: 'rate-limited', until: now + 8000 } });
    await shot('06-busy-429');
    await setAi(page, { wait: { worldId: id, reason: 'server', until: now + 20_000 } });
    await shot('07-queued');
    await reset(page, id);

    // Done: the next ideas, the toned-down note, a new member to draw, lines the student wrote.
    const manifest = await page.evaluate(() => (window as unknown as AmbleWindow).__amble.getState().session.manifest);
    await setAi(page, {
      lastOutcome: {
        kind: 'accepted',
        files: [],
        manifest,
        summary: 'the Moon King stomps when he is angry.',
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
    await page.evaluate(() => {
      const a = (window as unknown as AmbleWindow).__amble;
      a.setState((s) => {
        s.app.toasts = [];
      });
    });
    await shot('08-done');
    await reset(page, id);

    // Refused, failed (with details), stopped, the ladder's card.
    await setAi(page, { lastOutcome: { kind: 'refused', note: "Games about real people from your school or family aren't allowed, even as a joke.", alternatives: ['Make up a character with a funny name', 'A villain made of socks'] }, outcomeFor: outcomeFor() });
    await shot('09-refused');
    await reset(page, id);
    await setAi(page, { lastOutcome: { kind: 'failed', reason: 'runtime', message: "Amble couldn't make that work this time. Your world is just like before.", details: ["boss.js line 3: Cannot read properties of undefined (reading 'amount')", 'game.js line 88: boss is not defined'] }, outcomeFor: outcomeFor() });
    await page.getByRole('button', { name: 'Details' }).click();
    await shot('10-failed-details');
    await reset(page, id);
    await setAi(page, { lastOutcome: { kind: 'fallback', files: [], manifest, message: "Amble couldn't build all of it, so it started you from Moon King with your ideas. Your other characters are waiting on the cast line. Try asking again when you're ready." }, outcomeFor: outcomeFor('build', 'Help Shelly rescue her friends') });
    await shot('11-ladder');
    await reset(page, id);

    // The crisis card.
    await page.getByTestId('ai-field').fill('nobody would care if i died');
    await page.getByTestId('ai-send').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot('12-crisis');
    await page.getByRole('dialog').getByRole('button', { name: 'Back to my world' }).click();

    // The steer toast.
    await page.getByTestId('ai-field').fill('make the jump higher');
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('ai-steer')).toBeVisible();
    await shot('13-steer-toast');
    await reset(page, id);

    // The helper's statuses.
    for (const status of ['off', 'offline', 'blocked', 'quota', 'expired', 'busy'] as const) {
      await setAi(page, { status });
      await shot(`14-status-${status}`);
    }
    await setAi(page, { status: 'explain-only', explain: { worldId: id, question: 'What does the Moon King do when he gets angry?', path: 'game.js', reply: { answer: 'When his health drops, the Moon King moves faster and throws more orbs.', lines: [{ from: 72, to: 80, note: 'phases() changes his attacks at 66% and 33% health.' }], safetyNote: '' }, error: null, at: now } });
    await shot('15-explain-only');
    await reset(page, id);

    // The build pill, building and ready.
    await setAi(page, { job: { worldId: id, task: 'build', request: 'Help Shelly rescue her friends', progress: { phase: 'writing', chars: 7400 }, startedAt: now } });
    await shot('16-build-pill');
    await setAi(page, { job: null, lastOutcome: { kind: 'accepted', files: [], manifest, summary: '', play: '', next: [], safety: { kind: 'ok', note: '' }, repairs: 0, tested: true, handEditsTouched: false, newArt: [] }, outcomeFor: outcomeFor('build', 'Help Shelly rescue her friends') });
    await shot('17-build-ready');
    await reset(page, id);

    // What Amble sends, with a request in it.
    await page.evaluate(async () => {
      const a = (window as unknown as AmbleWindow).__amble;
      const body = JSON.stringify({ model: 'test-model', store: false, stream: true, max_completion_tokens: 8000, messages: [{ role: 'system', content: '# ROLE…' }, { role: 'user', content: 'Task: change\nContent level: middle\n…' }] });
      await a.services.store.ailog.add({ id: 'g_shot000001', at: Date.now(), kind: 'change', host: 'ai.test', model: 'test-model', bytesSent: body.length, bytesReceived: 1830, included: ['your words', 'game.js (106 lines)', 'the list of drawings (no pictures)', 'the dial settings'], body, status: 'ok', replySummary: 'Changed game.js' });
    });
    await mountHarness(page, 'sent');
    await page.getByRole('button', { name: 'Show exactly' }).first().click();
    await shot('18-whats-sent');
  });
}
