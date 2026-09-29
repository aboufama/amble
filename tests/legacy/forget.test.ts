/**
 * "Delete everything Amble keeps on this Chromebook" (§2.15) includes the old editor's autosave: the next
 * student on a shared Chromebook must not be offered the last one's old drawings. Only its one key goes:
 * idb-keyval's database is shared with anything else on the same origin.
 */
import 'fake-indexeddb/auto';
import { get, set } from 'idb-keyval';
import { describe, expect, it, vi } from 'vitest';
import { forgetLegacyAutosave, LEGACY_AUTOSAVE_KEY, readLegacyAutosave } from '../../src/legacy/reader';
import { deleteEverything } from '../../src/screens/settings/StorageSection';
import { MemoryStore } from '../../src/store/memory';

const oldProject = {
  format: 'amble',
  version: 1,
  mode: '2d',
  title: 'My old game',
  stage: { id: 'stage', kind: 'stage', costumes: [], sounds: [] },
  sprites: [{ id: 't1', kind: 'sprite', name: 'Cat', costumes: [{ id: 'c1', kind: 'image', name: 'me', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', mime: 'image/png' }], sounds: [] }],
};

describe('forgetting the old autosave', () => {
  it('removes only the old editor key', async () => {
    await set(LEGACY_AUTOSAVE_KEY, oldProject);
    await set('another-app', 'keep me');
    expect(await readLegacyAutosave()).not.toBeNull();
    await forgetLegacyAutosave();
    expect(await get(LEGACY_AUTOSAVE_KEY)).toBeUndefined();
    expect(await get('another-app')).toBe('keep me');
    expect(await readLegacyAutosave()).toBeNull();
  });

  it('is part of Delete everything', async () => {
    await set(LEGACY_AUTOSAVE_KEY, oldProject);
    const reload = vi.fn();
    await deleteEverything(new MemoryStore(), reload);
    expect(await get(LEGACY_AUTOSAVE_KEY)).toBeUndefined();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does nothing when there is no old autosave', async () => {
    await expect(forgetLegacyAutosave()).resolves.toBeUndefined();
  });
});
