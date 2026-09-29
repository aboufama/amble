/**
 * Kid safety in the Ask card (§2.8, §2.16, §5.13): crisis words send nothing and show the crisis card;
 * real-person requests are refused on the device with the two alternatives; personal info is flagged as
 * it is typed (Send anyway only above elementary); the model's refusal and toned-down notes show as cards.
 */
import { expect, openAmble, test } from '../helpers/app';
import { aiFixture, mockAi } from '../helpers/mockAi';
import { ask, askState, mountHarness, openStarterWorld, outcomeOf, skipExplainer, stepTexts } from './harness';

test('crisis words: the crisis card, nothing sent, only "refused: support" recorded', async ({ page }) => {
  const ai = await mockAi(page, { patches: [] });
  await openAmble(page, { ai: 'mock', clean: true });
  const id = await openStarterWorld(page);
  await mountHarness(page);
  await skipExplainer(page);

  await ask(page, 'nobody would care if i died');
  const card = page.getByRole('dialog', { name: 'It sounds like things might be really hard right now.' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('You deserve support. Please talk to a teacher, a counselor, or another adult you trust.');
  await expect(card).toContainText('In New Hampshire you can call or text 988, or call 1-833-710-6477 (NH Rapid Response, free, any time).');
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
  const id = await openStarterWorld(page);
  await mountHarness(page);
  await skipExplainer(page);

  await ask(page, 'make the boss look like my teacher Mr Smith and beat him up');
  await expect(askState(page)).toHaveAttribute('data-state', 'refused');
  const card = page.getByTestId('ai-refusal');
  await expect(card).toContainText("Amble can't make that one. How about one of these?");
  await expect(card).toContainText("Games about real people from your school or family aren't allowed, even as a joke.");
  await page.getByRole('button', { name: 'Make up a character with a funny name' }).click();
  await expect(page.getByTestId('ai-field')).toHaveValue('Make up a character with a funny name');
  expect(ai.requests).toHaveLength(0);
  await expect.poll(async () => (await stepTexts(page, id)).at(-1)).toBe('refused: request');
});

test('personal info: Remove it, and Send anyway above elementary', async ({ page }) => {
  await mockAi(page, { patches: [] });
  await openAmble(page, { ai: 'mock', clean: true });
  await openStarterWorld(page);
  await mountHarness(page);
  await skipExplainer(page);

  await page.getByTestId('ai-field').fill('put my phone number 603-555-0199 on the boss');
  const warning = page.getByTestId('ai-pii');
  await expect(warning).toContainText("It looks like you typed personal info (like a name, phone or address). The AI doesn't need it.");
  await expect(warning.getByRole('button', { name: 'Send anyway' })).toBeVisible();
  await warning.getByRole('button', { name: 'Remove it' }).click();
  await expect(page.getByTestId('ai-field')).toHaveValue('put my phone number on the boss');
  await expect(warning).toBeHidden();
});

test('personal info at elementary: no Send anyway, and Ask waits until it is removed', async ({ page }) => {
  await mockAi(page, { patches: [] });
  await openAmble(page, { ai: 'mock', clean: true, classLink: { level: 'elementary' } });
  await openStarterWorld(page);
  await mountHarness(page);
  await skipExplainer(page);

  await page.getByTestId('ai-field').fill('my phone is 603-555-0199');
  const warning = page.getByTestId('ai-pii');
  await expect(warning).toBeVisible();
  await expect(warning.getByRole('button', { name: 'Send anyway' })).toHaveCount(0);
  await expect(page.getByTestId('ai-send')).toBeDisabled();
});

test("the model's refusal shows the refusal card; a toned-down change shows the paper note", async ({ page }) => {
  const toned = aiFixture('change-stomp.patch').replace('@@safety ok', '@@safety toned-down: the minions bounce off instead of getting hurt.');
  const ai = await mockAi(page, { patches: ['refused.patch', { text: toned }] });
  await openAmble(page, { ai: 'mock', clean: true });
  const id = await openStarterWorld(page);
  await mountHarness(page);
  await skipExplainer(page);

  await ask(page, 'make the fight really gross');
  expect(await outcomeOf(page, id)).toBe('refused');
  await expect(page.getByTestId('ai-refusal')).toContainText("Amble can't make that one. How about one of these?");
  await expect.poll(async () => (await stepTexts(page, id)).at(-1)).toBe('refused: request');

  await ask(page, 'let me stomp on the minions');
  await expect.poll(() => ai.tasks('change').length).toBe(2);
  await expect(page.getByTestId('ai-safety-note')).toHaveText('Amble made it a little gentler: the minions bounce off instead of getting hurt.', { timeout: 60_000 });
});
