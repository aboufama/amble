/**
 * The in-app pages must say what Amble really does (districts inventory them under NH RSA 189:66): the IT
 * page's managed configuration and build variables are the ones the AI core reads, the numbers in the
 * privacy notice match the app's limits, long page text renders as headings and lists, and Delete
 * everything empties the store.
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { classLinkToCore, resolveAiConfig, saveClassLink } from '../../src/cores/ai';
import { TABLES } from '../../src/i18n';
import { KEEP } from '../../src/model/limits';
import { BUILD_VARS, MANAGED_EXAMPLE } from '../../src/screens/pages/ItPage';
import { Prose } from '../../src/screens/pages/Prose';
import { deleteEverything } from '../../src/screens/settings/StorageSection';
import { MemoryStore } from '../../src/store/memory';
import { sampleClassLink } from '../foundation/samples';
import { fixtureWorld } from './fixtures';

const none = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('the IT page', () => {
  it('shows a managed configuration the AI core accepts as written: the class link brings the code', async () => {
    const alone = await resolveAiConfig({ env: {}, managed: MANAGED_EXAMPLE, local: none, session: none, dev: false, devServer: null });
    expect(alone).toMatchObject({ enabled: false, offReason: 'needs-class-link', baseUrl: 'https://amble-ai.sau99.org/v1', ageBandMax: 'middle', schoolMode: true, sharedDevice: true });
    expect(alone.district?.name).toBe('SAU 99');
    expect(alone.locked).toEqual(expect.arrayContaining(['ai', 'content']));

    const joinWith = async (baseUrl: string) => {
      const local = memoryStorage();
      const link = sampleClassLink({ level: 'high', ai: { baseUrl, model: 'x', auth: { type: 'class-code', header: 'X-Amble-Class', code: 'MAPLE-7Q2K' } } });
      saveClassLink(classLinkToCore(link)!, local);
      return resolveAiConfig({ env: {}, managed: MANAGED_EXAMPLE, local, session: none, dev: false, devServer: null });
    };
    // The teacher's link to the district's address brings the class code; the level stays under the ceiling.
    expect(await joinWith('https://amble-ai.sau99.org/v1')).toMatchObject({ enabled: true, baseUrl: 'https://amble-ai.sau99.org/v1', ageBand: 'middle' });
    // A code for another address is never sent to the district's.
    expect(await joinWith('https://elsewhere.example/v1')).toMatchObject({ enabled: false, offReason: 'needs-class-link' });
  });

  it('documents only build variables the AI core reads', () => {
    const env = readFileSync(new URL('../../src/ai/config/env.ts', import.meta.url), 'utf8');
    for (const [name] of BUILD_VARS) {
      const suffix = name.replace(/^VITE_AMBLE_/, '');
      expect(env, name).toContain(`'${suffix}'`);
    }
  });

  it('builds a working config from the documented example values', async () => {
    const env = Object.fromEntries(BUILD_VARS.filter(([, v]) => !v.includes(' | ')).map(([k, v]) => [k, v]));
    const ai = await resolveAiConfig({ env, managed: null, local: none, session: none, dev: false, devServer: null });
    expect(ai).toMatchObject({ enabled: true, baseUrl: 'https://amble-ai.sau99.org/v1', schoolMode: true });
  });
});

describe('the privacy notice', () => {
  it('states the numbers the app keeps to', () => {
    const school = TABLES.school as Record<string, string>;
    expect(KEEP.aiLogEntries).toBe(50);
    expect(school.privInvLog).toContain(`last ${KEEP.aiLogEntries} AI requests`);
    expect(school.page_sentLede).toContain(`last ${KEEP.aiLogEntries}`);
  });

  it('never names a real email address or a key', () => {
    const school = TABLES.school as Record<string, string>;
    for (const [key, text] of Object.entries(school)) {
      if (key.startsWith('it') || key.startsWith('page_it')) continue;
      expect(text, key).not.toMatch(/[\w.+-]+@[\w-]+\.(?:com|edu|org|net)\b/);
      expect(text, key).not.toMatch(/\bsk-[A-Za-z0-9]{8,}/);
    }
  });
});

describe('page text', () => {
  it('renders headings, lists, numbered steps, bold and code, never raw HTML', () => {
    const html = renderToStaticMarkup(createElement(Prose, { text: '## What works\n- **Keys** work\n- `F6` jumps\n\n1. Open\n2. Join\n\nPlain <b>text</b>.' }));
    expect(html).toBe('<h3 class="page__h">What works</h3><ul><li><strong>Keys</strong> work</li><li><code>F6</code> jumps</li></ul><ol><li>Open</li><li>Join</li></ol><p>Plain &lt;b&gt;text&lt;/b&gt;.</p>');
  });
});

describe('Delete everything', () => {
  it('empties the store and starts Amble fresh', async () => {
    const store = new MemoryStore();
    await store.commit({ worlds: [fixtureWorld()] });
    await store.settings.put('classLink', sampleClassLink());
    const reload = vi.fn();
    await deleteEverything(store, reload);
    expect(await store.worlds.list()).toEqual([]);
    expect(await store.settings.get('classLink')).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });
});
