/**
 * Settings → Storage (§2.15, §4.3): how much space Amble uses, Keep my worlds safe (persistent storage),
 * Save all my worlds (M6's one zip of .amble files), Lost and found, and Delete everything Amble keeps on
 * this Chromebook (typed confirmation). Files saved to Drive are never touched. The old editor's autosave
 * goes too (its drawings are drawings Amble keeps here, and the wipe forgets it was already offered, so
 * the next student would be offered them), but only its own key.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from '../../app/Link';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { forgetLegacyAutosave } from '../../legacy/reader';
import { flushTeacherData } from '../../school/teacherData';
import { announce, showToast } from '../../state/app';
import { upkeepOf, type Store } from '../../store';
import { formatBytes, requestPersist, spaceInfo, type SpaceInfo } from '../../store/quota';
import { Button, Meter } from '../../ui/components';
import { askUser } from '../../ui/dialogs';
import { Icon } from '../../ui/icons';
import { SaveAllButton } from '../files/SaveAllButton';
import { Group } from './parts';

export { formatBytes };

function clearKeys(get: () => Storage): void {
  try {
    const storage = get();
    for (const key of Object.keys(storage)) if (key.startsWith('amble')) storage.removeItem(key);
  } catch {
    // Storage blocked: nothing kept there.
  }
}

function deleteDatabase(): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      const r = indexedDB.deleteDatabase('amble');
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Deletes what Amble keeps in this browser profile: the store (every world, drawing, footstep, setting and
 * the What Amble sends log) and Amble's own keys (the class joined, the AI settings, the device id). Then
 * Amble starts fresh on the first page.
 */
export async function deleteEverything(store: Store, reload: () => void = () => location.reload()): Promise<void> {
  await flushTeacherData().catch(() => undefined);
  const upkeep = upkeepOf(store);
  let wiped = false;
  if (upkeep) {
    try {
      await upkeep.wipe();
      wiped = true;
    } catch {
      wiped = false;
    }
  }
  if (!wiped) await deleteDatabase();
  // The old editor's autosave too: its drawings are this Chromebook's as much as the new ones.
  await forgetLegacyAutosave();
  clearKeys(() => localStorage);
  clearKeys(() => sessionStorage);
  try {
    history.replaceState(null, '', `${location.pathname}${location.search}#/`);
  } catch {
    // Some embedders block history; the reload still starts fresh.
  }
  reload();
}

export function StorageSection() {
  const services = useServices();
  const { store } = services;
  const [space, setSpace] = useState<SpaceInfo | null>(null);
  const [asked, setAsked] = useState<'granted' | 'denied' | null>(null);

  const measure = useCallback(() => {
    void store
      .estimate()
      .then((e) => setSpace(e.quota > 0 ? spaceInfo(e) : null))
      .catch(() => setSpace(null));
  }, [store]);
  useEffect(measure, [measure]);

  const keepSafe = async () => {
    const granted = await requestPersist();
    setAsked(granted ? 'granted' : 'denied');
    announce(granted ? t('school.setSafeYes') : t('school.setSafeNotYet'));
    measure();
  };

  const wipe = async () => {
    const typed = await askUser({ title: t('school.setDeleteTitle'), body: t('school.setDeleteBody'), label: t('school.setDeleteType'), ok: t('school.setDeleteOk'), maxLength: 20 });
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== 'DELETE') {
      showToast(t('school.setDeleteNot'));
      return;
    }
    await deleteEverything(store);
  };

  const memory = store.mode === 'memory';
  const persisted = space?.persisted || asked === 'granted';
  const used = space ? t('school.setUsing', { used: formatBytes(space.usage), total: formatBytes(space.quota) }) : '';

  return (
    <div className="set-storage">
      <Group title={t('school.setSpaceTitle')}>
        {memory ? (
          <p className="set-warn">
            <Icon name="warning" size={16} />
            {t('school.setFilesOnly')}
          </p>
        ) : space ? (
          <>
            <p className="set-row__label" data-testid="storage-usage">
              {used}
            </p>
            <Meter label={t('school.setSpaceTitle')} value={space.usage} max={Math.max(space.quota, 1)} tone={space.low ? 'warn' : 'alive'} valueText={used} />
          </>
        ) : (
          <p className="set-row__hint">{t('school.setSpaceUnknown')}</p>
        )}
      </Group>
      {!memory && (
        <Group title={t('school.setSafeTitle')}>
          <p className="set-row__hint">{persisted ? t('school.setSafeYes') : asked === 'denied' ? t('school.setSafeNotYet') : t('school.setSafeNo')}</p>
          {!persisted && (
            <p>
              <Button variant="ghost" icon="check" onClick={() => void keepSafe()}>
                {t('school.setSafeButton')}
              </Button>
            </p>
          )}
        </Group>
      )}
      <Group title={t('school.setBackupTitle')}>
        <p className="set-row__hint">{t('school.setBackupText')}</p>
        <div className="set-actions">
          <SaveAllButton variant="lantern" />
          <Link to={{ name: 'trail', view: 'lost' }} className="btn btn--ghost btn--h44">
            <Icon name="trail" size={20} />
            <span className="btn__label">{t('common.routeTrailLost')}</span>
          </Link>
        </div>
      </Group>
      <Group title={t('school.setDeleteGroup')}>
        <p className="set-row__hint">{t('school.setDeleteHint')}</p>
        <p>
          <Button variant="danger" icon="close" onClick={() => void wipe()} data-testid="delete-everything">
            {t('school.setDeleteButton')}
          </Button>
        </p>
      </Group>
    </div>
  );
}
