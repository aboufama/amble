/**
 * Settings → Storage (§2.15, §4.3): how much space Amble uses, Keep my worlds safe (persistent storage),
 * Save all my worlds (one zip of .amble files), Lost and found, and Delete everything Amble keeps on this
 * Chromebook (typed confirmation). Old Amble's data and files saved to Drive are never touched.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from '../../app/Link';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { saveBlob } from '../../school/saveFile';
import { flushTeacherData } from '../../school/teacherData';
import { announce, showToast } from '../../state/app';
import { Button, Meter } from '../../ui/components';
import { askUser } from '../../ui/dialogs';
import { Icon } from '../../ui/icons';
import { Group } from './parts';

export function formatBytes(n: number): string {
  if (n >= 1e9) return t('school.sizeGb', { n: (n / 1e9).toFixed(1) });
  if (n >= 1e6) return t('school.sizeMb', { n: Math.max(1, Math.round(n / 1e6)) });
  return t('school.sizeKb', { n: Math.max(1, Math.round(n / 1e3)) });
}

function clearKeys(storage: Storage | null): void {
  if (!storage) return;
  for (const key of Object.keys(storage)) if (key.startsWith('amble')) storage.removeItem(key);
}

function safe<T>(get: () => T): T | null {
  try {
    return get();
  } catch {
    return null;
  }
}

/** Deletes Amble's database and its keys in this browser profile, then starts Amble fresh. */
export async function deleteEverything(): Promise<void> {
  await flushTeacherData().catch(() => undefined);
  clearKeys(safe(() => localStorage));
  clearKeys(safe(() => sessionStorage));
  await new Promise<void>((resolve) => {
    try {
      const r = indexedDB.deleteDatabase('amble');
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
  location.replace(`${location.pathname}${location.search}#/`);
  location.reload();
}

export function StorageSection() {
  const { store, files } = useServices();
  const [usage, setUsage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [asked, setAsked] = useState<'granted' | 'denied' | null>(null);

  const measure = useCallback(() => {
    void store
      .estimate()
      .then(setUsage)
      .catch(() => setUsage(null));
  }, [store]);
  useEffect(measure, [measure]);

  const keepSafe = async () => {
    let granted = false;
    try {
      granted = (await navigator.storage?.persist?.()) ?? false;
    } catch {
      granted = false;
    }
    setAsked(granted ? 'granted' : 'denied');
    announce(granted ? t('school.setSafeYes') : t('school.setSafeNotYet'));
    measure();
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const zip = await files.saveAll();
      const day = new Date().toISOString().slice(0, 10);
      const saved = await saveBlob(zip, t('school.setSaveAllName', { day }), { description: t('school.setZipType'), mime: 'application/zip', ext: '.zip' });
      if (saved) showToast(t('school.setSaveAllDone', { name: saved.name }), { kind: 'success' });
    } catch {
      showToast(t('school.setSaveAllFailed'), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const wipe = async () => {
    const typed = await askUser({ title: t('school.setDeleteTitle'), body: t('school.setDeleteBody'), label: t('school.setDeleteType'), ok: t('school.setDeleteOk'), maxLength: 20 });
    if (typed === null) return;
    if (typed.trim() !== 'DELETE') {
      showToast(t('school.setDeleteNot'));
      return;
    }
    await deleteEverything();
  };

  const memory = store.mode === 'memory';
  const persisted = usage?.persisted || asked === 'granted';

  return (
    <div className="set-storage">
      <Group title={t('school.setSpaceTitle')}>
        {memory ? (
          <p className="set-warn">
            <Icon name="warning" size={16} />
            {t('school.setFilesOnly')}
          </p>
        ) : usage ? (
          <>
            <p className="set-row__label" data-testid="storage-usage">
              {t('school.setUsing', { used: formatBytes(usage.usage), total: formatBytes(usage.quota) })}
            </p>
            <Meter label={t('school.setSpaceTitle')} value={usage.usage} max={Math.max(usage.quota, 1)} tone={usage.usage / Math.max(usage.quota, 1) > 0.8 ? 'warn' : 'alive'} valueText={t('school.setUsing', { used: formatBytes(usage.usage), total: formatBytes(usage.quota) })} />
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
          <Button variant="lantern" icon="drive" busy={saving} onClick={() => void saveAll()}>
            {t('school.setSaveAll')}
          </Button>
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
