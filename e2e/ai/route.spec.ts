/** M5's starting point (FOUNDATION-STUB spec; M5 replaces it with the ai-* specs): the class link wires the mock AI. */
import { expect, openAmble, test } from '../helpers/app';
import { AI_BASE, CLASS_CODE, mockAi } from '../helpers/mockAi';

test('joining through the class link configures the AI helper for the mock endpoint', async ({ page }) => {
  const ai = await mockAi(page, { patches: ['build-moon-king.patch'], plan: 'plan-snail.json' });
  await openAmble(page, { ai: 'mock' });
  const config = await page.evaluate(() => (window as unknown as { __amble: { getState(): { config: { ai: { baseUrl: string; auth: { code?: string } } } } } }).__amble.getState().config.ai);
  expect(config.baseUrl).toBe(AI_BASE);
  expect(config.auth.code).toBe(CLASS_CODE);
  await expect(page.getByTestId('ai-chip')).toBeVisible();
  expect(ai.errors).toEqual([]);
});

test('the mock endpoint streams AMBLE PATCH replies and records requests', async ({ page }) => {
  const ai = await mockAi(page, { patches: ['change-stomp.patch'] });
  await openAmble(page);
  const reply = await page.evaluate(async () => {
    const res = await fetch('https://ai.test/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Amble-Class': 'TEST-1234' },
      body: JSON.stringify({ model: 'test-model', stream: true, messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'Task: change\nContent level: middle' }] }),
    });
    return { type: res.headers.get('content-type'), text: await res.text() };
  });
  expect(reply.type).toBe('text/event-stream');
  expect(reply.text).toContain('@@amble-patch 1');
  expect(reply.text.trim().endsWith('data: [DONE]')).toBe(true);
  expect(ai.tasks('change')).toHaveLength(1);
  expect(ai.requests[0].headers['x-amble-class']).toBe('TEST-1234');
});
