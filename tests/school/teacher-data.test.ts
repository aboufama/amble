/**
 * The Teacher desk's data on this device (§2.14): an edit made before the saved data has been read (a slow
 * first read of the device's storage) never writes over the saved assignments, and is never lost either.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeacherData } from '../../src/model/types';
import { flushTeacherData, loadTeacherData, resetTeacherData, teacherData, updateTeacherData } from '../../src/school/teacherData';
import { sampleAssignment } from '../foundation/samples';

const SAVED: TeacherData = { assignments: [sampleAssignment({ id: 'g_saved00001', title: 'Boss fight' }), sampleAssignment({ id: 'g_saved00002', title: 'Sky run' })], link: null, notes: {} };
const NEW = sampleAssignment({ id: 'g_new0000001', title: 'Maze' });

/** A settings store whose read of the teacher's data finishes when the test says so. */
function slowStore() {
  let finish: (v: unknown) => void = () => undefined;
  const puts: TeacherData[] = [];
  const store = {
    settings: {
      get: vi.fn(() => new Promise<unknown>((r) => (finish = r))),
      put: vi.fn(async (_key: string, value: unknown) => {
        puts.push(structuredClone(value as TeacherData));
      }),
      remove: vi.fn(async () => undefined),
    },
  };
  return { store: store as unknown as Parameters<typeof loadTeacherData>[0], puts, finish: (v: unknown) => finish(v) };
}

const titles = (d: TeacherData) => d.assignments.map((a) => a.title);

beforeEach(() => {
  vi.useFakeTimers();
  resetTeacherData();
});

afterEach(() => {
  vi.useRealTimers();
  resetTeacherData();
});

describe("the teacher's data", () => {
  it('never saves over the saved assignments when an edit comes before a read slower than the save delay', async () => {
    const s = slowStore();
    const loaded = loadTeacherData(s.store);
    updateTeacherData((d) => ({ ...d, assignments: [...d.assignments, NEW] }));
    // The edit's save is due after 400 ms; the read is still going.
    await vi.advanceTimersByTimeAsync(1000);
    for (const saved of s.puts) expect(titles(saved)).toEqual(expect.arrayContaining(['Boss fight', 'Sky run']));
    s.finish(SAVED);
    await loaded;
    await vi.advanceTimersByTimeAsync(1000);
    expect(titles(teacherData())).toEqual(['Boss fight', 'Sky run', 'Maze']);
    expect(s.puts.length).toBeGreaterThan(0);
    for (const saved of s.puts) expect(titles(saved)).toEqual(expect.arrayContaining(['Boss fight', 'Sky run']));
    expect(titles(s.puts[s.puts.length - 1])).toEqual(['Boss fight', 'Sky run', 'Maze']);
  });

  it('keeps an edit made before a quick read finished', async () => {
    const s = slowStore();
    const loaded = loadTeacherData(s.store);
    updateTeacherData((d) => ({ ...d, assignments: [...d.assignments, NEW] }));
    s.finish(SAVED);
    await loaded;
    expect(titles(teacherData())).toEqual(['Boss fight', 'Sky run', 'Maze']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(titles(s.puts[s.puts.length - 1])).toEqual(['Boss fight', 'Sky run', 'Maze']);
  });

  it('saves at once when the page hides, after the read', async () => {
    const s = slowStore();
    const loaded = loadTeacherData(s.store);
    updateTeacherData((d) => ({ ...d, assignments: [...d.assignments, NEW] }));
    const flushed = flushTeacherData();
    expect(s.puts).toEqual([]);
    s.finish(SAVED);
    await loaded;
    await flushed;
    expect(titles(s.puts[s.puts.length - 1])).toEqual(['Boss fight', 'Sky run', 'Maze']);
  });

  it('works as before when nothing was saved yet', async () => {
    const s = slowStore();
    const loaded = loadTeacherData(s.store);
    s.finish(null);
    await loaded;
    updateTeacherData((d) => ({ ...d, assignments: [...d.assignments, NEW] }));
    await vi.advanceTimersByTimeAsync(500);
    expect(titles(s.puts[s.puts.length - 1])).toEqual(['Maze']);
  });
});
