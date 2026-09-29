/** The friendly-name picker (§2.3): 200 names, never a taken one, tidy renames. */
import { describe, expect, it } from 'vitest';
import { cleanName, FRIENDLY_NAMES, pickName } from '../../src/screens/first/names';

const BANNED = /\b(sprite|stage|costume|backdrop|block|script|compile|asset|placeholder|rig)s?\b/i;
const STARTER_CHARACTERS = ['Pip', 'Dash', 'Bloop', 'Glim', 'Wobbles', 'Biscuit', 'Boo', 'Clank', 'Spiky', 'Grumble', 'Bubbles', 'Kite', 'Pal', 'Buddy', 'Rae'];

describe('friendly names', () => {
  it('has 200 different, short, friendly names', () => {
    expect(FRIENDLY_NAMES).toHaveLength(200);
    expect(new Set(FRIENDLY_NAMES.map((n) => n.toLowerCase())).size).toBe(200);
    for (const n of FRIENDLY_NAMES) {
      expect(n).toMatch(/^[A-Z][a-z]+(-[A-Z][a-z]+)?$/);
      expect(n.length).toBeLessThanOrEqual(12);
      expect(BANNED.test(n)).toBe(false);
    }
  });

  it("never borrows a starter world's character", () => {
    for (const n of STARTER_CHARACTERS) expect(FRIENDLY_NAMES).not.toContain(n);
  });

  it('picks from the list, avoiding names the student already uses', () => {
    expect(pickName([], () => 0)).toBe(FRIENDLY_NAMES[0]);
    expect(pickName(['blorp'], () => 0)).toBe(FRIENDLY_NAMES[1]);
    expect(pickName([], () => 0.9999)).toBe(FRIENDLY_NAMES[199]);
    const taken = FRIENDLY_NAMES.slice(0, 199);
    expect(pickName(taken, () => 0.5)).toBe(FRIENDLY_NAMES[199]);
  });

  it('counts up when every name is taken', () => {
    expect(pickName(FRIENDLY_NAMES, () => 0)).toBe(`${FRIENDLY_NAMES[0]} 2`);
    expect(pickName([...FRIENDLY_NAMES, `${FRIENDLY_NAMES[0]} 2`], () => 0)).toBe(`${FRIENDLY_NAMES[0]} 3`);
  });

  it('tidies a typed name (24 characters, single spaces) and keeps the old one when empty', () => {
    expect(cleanName('  Sir   Hops  ', 'Blorp')).toBe('Sir Hops');
    expect(cleanName('   ', 'Blorp')).toBe('Blorp');
    expect(cleanName('x'.repeat(40), 'Blorp')).toHaveLength(24);
  });
});
