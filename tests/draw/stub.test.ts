/** M3's starting point (FOUNDATION-STUB test; M3 replaces it). */
import { describe, expect, it } from 'vitest';
import { characterKind } from '../../src/draw/api';

describe('draw (stub)', () => {
  it('maps rig kinds to the characters that get bones', () => {
    expect(characterKind('biped')).toBe('biped');
    expect(characterKind('blob')).toBe('blob');
    expect(characterKind('none')).toBeNull();
  });
});
