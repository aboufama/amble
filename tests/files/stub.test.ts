/** M6's starting point (FOUNDATION-STUB test; M6 replaces it): files are not built yet, and say so. */
import { describe, expect, it } from 'vitest';
import { createFilesStub, FileProblem } from '../../src/files/api';
import { isNotBuiltYet } from '../../src/model/notBuilt';
import { sampleWorld } from '../foundation/samples';

describe('files (stub)', () => {
  it('throws NotBuiltYet for file actions and finds no old projects', async () => {
    const files = createFilesStub();
    await expect(files.saveWorld(sampleWorld())).rejects.toSatisfy(isNotBuiltYet);
    await expect(files.legacy.find()).resolves.toBeNull();
    expect(new FileProblem('too-big', 'This world is 62 MB, which is too big to open here.').kind).toBe('too-big');
  });
});
