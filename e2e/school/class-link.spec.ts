/**
 * Class links end to end (§2.13, §2.14): the Join card turns the teacher's AI helper on, Settings shows the
 * class and leaves it, an expired link says so and leaves Amble working, and a link for another class asks
 * to switch.
 */
import { classLinkPayload, expect, openAmble, TEST_CLASS, test, waitForApp } from '../helpers/app';
import { AI_BASE, mockAi } from '../helpers/mockAi';

test('Join turns the AI helper on, and Leave this class turns it off', async ({ page }) => {
  await mockAi(page);
  await page.goto(`./#class=${classLinkPayload()}`);
  await waitForApp(page);
  const card = page.getByRole('dialog');
  await expect(card.getByRole('heading', { name: 'Join Test class?' })).toBeVisible();
  await expect(card).toContainText('Your drawings stay yours and stay here.');
  // The class and district names come from the link: the card also says where the words will go.
  await expect(card.getByTestId('join-host')).toHaveText(`Your words will go to ${new URL(AI_BASE).host}.`);
  await card.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(card).toBeHidden();
  await expect(page.getByTestId('toasts').getByText('You joined Test class.')).toBeVisible();
  // The fragment (and its class code) is gone from the address bar.
  expect(new URL(page.url()).hash).not.toContain('class=');
  await page.waitForFunction(() => (window as any).__amble.getState().config.aiMode === 'on');

  await page.evaluate(() => (location.hash = '#/settings/ai'));
  await expect(page.getByTestId('class-name')).toHaveText('Test class');
  await page.getByRole('button', { name: 'Leave this class' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave this class' }).click();
  await page.waitForFunction(() => (window as any).__amble.getState().config.classLink === null);
  await expect(page.getByTestId('ai-status')).toContainText('Off');
});

test('an expired link says so and Amble keeps working', async ({ page }) => {
  await page.goto(`./#class=${classLinkPayload({ ...TEST_CLASS, exp: '2020-01-31' })}`);
  await waitForApp(page);
  const card = page.getByRole('dialog');
  await expect(card).toContainText('This class link has expired. Ask your teacher for a new one. Amble still works without it.');
  await card.getByRole('button', { name: 'Go to Amble' }).click();
  await expect(card).toBeHidden();
  expect(await page.evaluate(() => (window as any).__amble.getState().config.classLink)).toBeNull();
});

test('a link for another class asks to switch', async ({ page }) => {
  await mockAi(page);
  await openAmble(page, { ai: 'mock' });
  await page.goto(`./#class=${classLinkPayload({ ...TEST_CLASS, cls: 'Room 7' })}`);
  await waitForApp(page);
  const card = page.getByRole('dialog');
  await expect(card).toContainText("You're in Test class on this Chromebook. Switch to Room 7?");
  await card.getByRole('button', { name: 'Switch', exact: true }).click();
  await page.waitForFunction(() => (window as any).__amble.getState().config.classLink?.cls === 'Room 7');
});
