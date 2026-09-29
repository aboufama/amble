/**
 * Where two modules meet on data rather than screens (§8.6): the AI pipeline's picture of the starters
 * (M5's plan call and ladder) must be M8's real starters, and the plan fixture the e2e journeys use must
 * map onto them.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PlanReply } from '../../src/model/types';
import { ladderFiles } from '../../src/pipeline/ladder';
import { readStatics } from '../../src/pipeline/manifest';
import { STARTER_IDS as PLAN_STARTERS, STARTER_LINES } from '../../src/pipeline/plan';
import { metaOf, STARTER_IDS } from '../../src/starters/catalog';
import { starterCode } from '../../src/starters/open';

const PLAN = JSON.parse(readFileSync(new URL('../../e2e/fixtures/ai/plan-snail.json', import.meta.url), 'utf8')) as PlanReply;

describe('the plan call knows the real starters', () => {
  it('offers exactly the starters M8 ships', () => {
    expect([...PLAN_STARTERS].sort()).toEqual([...STARTER_IDS].sort());
  });

  it("names only each starter's real cast keys, hero and your-turn member first among them", async () => {
    for (const id of STARTER_IDS) {
      const meta = metaOf(id);
      const declared = Object.keys(readStatics(await starterCode(meta)).art);
      const keys = STARTER_LINES[id].keys;
      expect(keys.filter((k) => !declared.includes(k)), `${id}: keys the game does not declare`).toEqual([]);
      expect(keys, id).toContain(meta.heroKey);
      if (meta.yourTurn) expect(keys, id).toContain(meta.yourTurn);
    }
  });
});

describe('the ladder on a real starter', () => {
  it("writes the e2e plan onto the Moon King's own slots, keys kept", async () => {
    const starter = await starterCode(metaOf('moon-king'));
    const { files, mapping, resting } = ladderFiles(PLAN, starter);
    expect(mapping).toEqual({ hero: 'hero', saltKing: 'moonKing', crumb: 'grumble', leaf: 'star' });
    expect(resting).toEqual([]);
    const art = readStatics(files).art;
    expect(Object.keys(art).sort()).toEqual(Object.keys(readStatics(starter).art).sort());
    expect(art.moonKing).toMatchObject({ name: 'The Salt King', ask: 'Draw the Salt King, a grumpy salt shaker' });
    expect(files.map((f) => f.path)).toEqual(starter.map((f) => f.path));
  });
});
