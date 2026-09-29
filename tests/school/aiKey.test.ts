/**
 * Settings → AI helper in a build that sets the AI address and asks for the user's own key
 * (`VITE_AMBLE_AI_AUTH=user-key`, §5.14): the status line promises a key field below, so the key field is
 * offered, for that address, and nothing else of the manual setup is.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { layerFromEnv, mergeLayers } from '../../src/ai';
import { ServicesProvider, type Services } from '../../src/app/services';
import { KeySetup, offWords, setupOffered } from '../../src/screens/settings/AiSection';
import { MemoryStore } from '../../src/store/memory';

const URL_ = 'https://ai.district.example/v1';
const build = (vars: Record<string, string>) => mergeLayers([layerFromEnv({ VITE_AMBLE_AI_BASE_URL: URL_, ...vars })]);
const services = { store: new MemoryStore(), school: { leave: async () => undefined } } as unknown as Services;

describe('Settings → AI helper', () => {
  it('offers the key field alone for a user-key build, as the status line says', () => {
    const ai = build({ VITE_AMBLE_AI_AUTH: 'user-key' });
    expect(offWords(ai)).toBe('A grown-up can add an AI key below to turn it on.');
    expect(setupOffered(ai, false)).toBe('key');
    expect(ai.userKeyFor).toBe(URL_);
  });

  it('draws one key field for that address, with its warning, and nothing that could point it elsewhere', () => {
    const html = renderToStaticMarkup(createElement(ServicesProvider, { value: services }, createElement(KeySetup, { address: URL_, model: 'amble-default' })));
    expect(html).toContain('uses the AI helper at ai.district.example');
    // One field: the key (Remember on this Chromebook is a switch that says how long the key is kept).
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html).toMatch(/<label[^>]*>Key<\/label>/);
    expect(html).toContain('type="password"');
    expect(html).toContain('Never type a school or paid key on a shared Chromebook.');
    expect(html).toMatch(/role="switch"[\s\S]*Remember on this Chromebook|Remember on this Chromebook[\s\S]*role="switch"/);
    for (const other of ['Base URL', 'Fast model', '>Model<']) expect(html).not.toContain(other);
  });

  it('offers no key field to class-code builds, and the whole manual setup only to the public build', () => {
    expect(setupOffered(build({ VITE_AMBLE_AI_AUTH: 'class-code' }), false)).toBeNull();
    expect(setupOffered(build({ VITE_AMBLE_AI_AUTH: 'none' }), false)).toBeNull();
    expect(setupOffered(mergeLayers([]), false)).toBe('manual');
    expect(setupOffered(mergeLayers([]), true)).toBeNull();
  });

  it('never promises a key field in a school build that asks for a key', () => {
    const ai = build({ VITE_AMBLE_SCHOOL_MODE: 'true', VITE_AMBLE_AI_AUTH: 'user-key' });
    expect(setupOffered(ai, true)).toBeNull();
    expect(offWords(ai)).toBe("This copy of Amble asks for an AI key, and school copies never take one. Ask your school's tech team.");
  });
});
