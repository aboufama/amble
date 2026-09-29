/**
 * Kid safety in the wish box (§2.8, §2.16, §5.13), in plain, kind words (MAGIC-BRIEF.md): crisis words
 * send nothing and show the crisis card, word for word as before; real-person wishes are refused on the
 * device with the two alternatives; private info is flagged as it is typed ("Make it happen anyway" only
 * above elementary); the service's refusal and gentler notes show as cards, never in its own voice.
 */
import { expect, openAmble, test } from '../helpers/app';
import { aiFixture, mockAi } from '../helpers/mockAi';
import { ask, askState, mountHarness, openFixtureWorld, outcomeOf, stepTexts } from './harness';

test('crisis words: the crisis card, nothing sent, only "refused: support" recorded', async ({ page }) => {
  const ai = await mockAi(page, { patches: [] });
  await openAmble(page, { ai: 'mock', clean: true });
  const id = await openFixtureWorld(page);
  await mountHarness(page);

  await ask(page, 'nobody would care if i died');
  const card = page.getByRole('dialog', { name: 'It sounds like things might be really hard right now.' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('You deserve support. Please talk to a teacher, a counselor, or another adult you trust.');
  await expect(card).toContainText('In New Hampshire you can call or text 988, or call 1-833-710-6477 (NH Rapid Response, free, any time).');
  // The number never breaks at a hyphen ("1-" on one line, "833-710-6477" on the next).
  const number = card.locator('.ai-crisis__number');
  await expect(number).toHaveText('1-833-710-6477');
  await expect(number).toHaveCSS('white-space', 'nowrap');
  await expect(page.getByTestId('ai-field')).toHaveValue('');
  await card.getByRole('button', { name: 'Back to my world' }).click();
  await expect(card).toBeHidden();

  expect(ai.requests).toHaveLength(0);
  await expect.poll(async () => (await stepTexts(page, id)).at(-1)).toBe('refused: support');
  expect((await stepTexts(page, id)).join('\n')).not.toContain('died');
});

test('a game about a real person is refused on the device, with two kind alternatives', async ({ page }) => {
  const ai = await mockAi(page, { patches: [] });
  await openAmble(page, { ai: 'mock', clean: true });
  const id = await openFixtureWorld(page);
  await mountHarness(page);

  await ask(page, 'make the boss look like my teacher Mr Smith and beat him up');
  await expect(askState(page)).toHaveAttribute('data-state', 'refused');
  const card = page.getByTestId('ai-refusal');
  await expect(card).toContainText("Let's keep it friendly.");
  await expect(card).toContainText("Games about real people from your school or family aren't allowed, even as a joke.");
  await expect(page.getByRole('group', { name: 'Try:' })).toBeVisible();
  await page.getByRole('button', { name: 'Make up a character with a funny name' }).click();
  await expect(page.getByTestId('ai-field')).toHaveValue('Make up a character with a funny name');
  expect(ai.requests).toHaveLength(0);
  // Footsteps keep the category, never the words (§5.13).
  await expect.poll(async () => (await stepTexts(page, id)).at(-1)).toBe('refused: real-person');
  expect((await stepTexts(page, id)).join('\n')).not.toContain('Mr Smith');
});

test('private info: Remove it, and Make it happen anyway above elementary', async ({ page }) => {
  await mockAi(page, { patches: [] });
  await openAmble(page, { ai: 'mock', clean: true });
  await openFixtureWorld(page);
  await mountHarness(page);

  await page.getByTestId('ai-field').fill('put my phone number 603-555-0199 on the boss');
  const warning = page.getByTestId('ai-pii');
  await expect(warning).toContainText('That looks like private info (a name, a phone number or an address). Leave it out and try again.');
  await expect(warning.getByRole('button', { name: 'Make it happen anyway' })).toBeVisible();
  await warning.getByRole('button', { name: 'Remove it' }).click();
  await expect(page.getByTestId('ai-field')).toHaveValue('put my phone number on the boss');
  await expect(warning).toBeHidden();
});

test('private info at elementary: no Make it happen anyway, and the wish waits until it is removed', async ({ page }) => {
  await mockAi(page, { patches: [] });
  await openAmble(page, { ai: 'mock', clean: true, classLink: { level: 'elementary' } });
  await openFixtureWorld(page);
  await mountHarness(page);

  await page.getByTestId('ai-field').fill('my phone is 603-555-0199');
  const warning = page.getByTestId('ai-pii');
  await expect(warning).toBeVisible();
  await expect(warning.getByRole('button', { name: 'Make it happen anyway' })).toHaveCount(0);
  await expect(page.getByTestId('ai-send')).toBeDisabled();
});

test("the service's refusal shows the refusal card without its own voice; a gentler change says so", async ({ page }) => {
  const toned = aiFixture('change-stomp.patch').replace('@@safety ok', '@@safety toned-down: the minions bounce off instead of getting hurt.');
  const ai = await mockAi(page, { patches: ['refused.patch', { text: toned }] });
  await openAmble(page, { ai: 'mock', clean: true });
  const id = await openFixtureWorld(page);
  await mountHarness(page);

  await ask(page, 'make the fight really gross');
  expect(await outcomeOf(page, id)).toBe('refused');
  const card = page.getByTestId('ai-refusal');
  await expect(card).toContainText("Let's keep it friendly.");
  // The reply's note keeps only what is fit for students: "I can't…" goes, the kind idea stays.
  await expect(card).toContainText('Want the Moon King to be the villain instead?');
  await expect(card).not.toContainText("I can't");
  // The service said no without naming a category.
  await expect.poll(async () => (await stepTexts(page, id)).at(-1)).toBe('refused: flagged');

  await ask(page, 'let me stomp on the minions');
  await expect.poll(() => ai.tasks('change').length).toBe(2);
  await expect(page.getByTestId('ai-safety-note')).toHaveText('A little gentler: the minions bounce off instead of getting hurt.', { timeout: 60_000 });
});
