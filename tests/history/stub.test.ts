/** M9's starting point (FOUNDATION-STUB test; M9 replaces it): footsteps always append. */
import { describe, expect, it } from 'vitest';
import { createHistoryStub } from '../../src/history/api';
import { sampleWorld } from '../foundation/samples';

describe('history (stub)', () => {
  it('records and goes back by appending steps, never deleting', async () => {
    const history = createHistoryStub();
    const world = sampleWorld();
    const next = await history.record(world, { kind: 'dials', by: 'student', text: 'You turned Jump height up to 820.' });
    expect(next.steps).toHaveLength(2);
    expect(next.head).toBe(next.steps[1].id);
    const back = await history.goBack(next, world.steps[0].id);
    expect(back.steps.map((s) => s.kind)).toEqual(['start', 'dials', 'goback']);
    expect(world.steps).toHaveLength(1);
  });

  it('attributes changed files to their author', () => {
    const history = createHistoryStub();
    const prev = sampleWorld().code;
    const next = [{ ...prev[0], source: `${prev[0].source}\n// mine` }];
    expect(history.attribute(prev, next, 'student')[0].authors).toEqual([['student', 5]]);
    expect(history.attribute(prev, prev, 'student')[0].authors).toEqual(prev[0].authors);
  });
});
