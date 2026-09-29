/** The build's dev-only guard (vite/devOnlyGuard.ts) knows each dev-only piece and nothing else. */
import { describe, expect, it } from 'vitest';
import { devOnlyIn } from '../../vite/devOnlyGuard';

describe('devOnlyIn', () => {
  it('finds the test hooks and the harnesses as a bundler writes them', () => {
    expect(devOnlyIn('if(x){window.__amble={services:s}}')).toEqual(['the editor test hook (window.__amble)']);
    expect(devOnlyIn('const w=window;w.__amble = { store }')).toEqual(['the editor test hook (window.__amble)']);
    expect(devOnlyIn('e.__ambleDesk=c')).toEqual(["the Desk's test hook (window.__ambleDesk)"]);
    expect(devOnlyIn('export function mountAiHarness(){}')).toEqual(['the AI cards harness (src/screens/ai/harness.tsx)']);
    expect(devOnlyIn('window.__m6=api')).toEqual(['the files harness (src/screens/files/harness/panel.tsx)']);
  });

  it("leaves alone what ships on purpose: the game's test hook, the boot clock and the loop guard", () => {
    expect(devOnlyIn('Object.defineProperty(window,"__ambleGame",{value:v})')).toEqual([]);
    expect(devOnlyIn('window.__ambleBoot=performance.now();')).toEqual([]);
    expect(devOnlyIn("const guard=`${o.guard??'__amble.guard()'};`")).toEqual([]);
  });
});
