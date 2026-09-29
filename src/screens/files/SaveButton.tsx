/**
 * **Save to Drive** in the world's top bar (§2.6; M6 owns, used by M2), and the save state beside it.
 * - The button says "Save file" when not on ChromeOS. It saves to the kept file (asking again for
 *   permission when needed), else through the picker, else as a download; Ctrl+S does the same.
 * - When Amble can't keep the world here (space full, files-only mode, a failing write), the button
 *   becomes the lantern: Save to Drive is then the way to keep the work.
 * - `SaveStatus`: ● Saved on this Chromebook · ◌ Saving… · ⚠ Not saved here: space is full. ·
 *   ⚠ Only saved in files. Changes are announced politely (the first save and failures only).
 */
import { useEffect, useRef, useState } from 'react';
import { useCommand } from '../../app/keys';
import { useServices } from '../../app/services';
import { isChromeOS } from '../../files/fsAccess';
import { t } from '../../i18n';
import type { SaveState, World } from '../../model/types';
import { announce, showToast } from '../../state/app';
import { useStore } from '../../state/store';
import { Button, type ButtonSize } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import './files.css';

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Where saving stands for this world: the session's save state, or the store's when it says more. */
export function useSaveState(): SaveState {
  const save = useStore((s) => s.session.save);
  const storage = useStore((s) => s.library.storage);
  if (storage === 'blocked') return 'files-only';
  if (storage === 'full' && save === 'saved') return 'full';
  return save;
}

export function saveLabel(): string {
  return isChromeOS() ? t('files.saveToDrive') : t('files.saveFile');
}

export interface SaveButtonProps {
  world: World;
  compact?: boolean;
  /** The save state, when the caller tracks it (default: the session's, with the store's health). */
  state?: SaveState;
  /** Called with the result (M2 shows "Last saved to Drive 10:42" in its menu and World info). */
  onSaved?(r: { name: string; at: number; method: 'fs-access' | 'download' }): void;
}

export function SaveButton({ world, compact = false, state: given, onSaved }: SaveButtonProps) {
  const { files } = useServices();
  const [busy, setBusy] = useState(false);
  const current = useSaveState();
  const state = given ?? current;
  const latest = useRef(world);
  latest.current = world;
  const busyRef = useRef(false);

  const save = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const saved = await files.saveWorld(latest.current);
      if (!saved) return;
      const text = saved.method === 'download' ? t('files.savedDownload') : isChromeOS() ? t('files.savedToDrive', { time: clock(saved.at) }) : t('files.savedToFile', { name: saved.name });
      showToast(text, { kind: 'success' });
      onSaved?.(saved);
    } catch (err) {
      console.warn('Save to Drive failed:', err);
      showToast(t('files.saveFailed'), { kind: 'error' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  useCommand('save', () => {
    void save();
  });

  const urgent = state === 'full' || state === 'files-only' || state === 'error';
  return (
    <Button
      variant={urgent ? 'lantern' : 'ghost'}
      icon="fileSave"
      size={(compact ? 38 : 44) as ButtonSize}
      busy={busy}
      onClick={() => void save()}
      data-testid="save-to-drive"
    >
      {busy ? t('files.saving') : saveLabel()}
    </Button>
  );
}

const STATE_TEXT: Record<SaveState, Parameters<typeof t>[0]> = {
  saved: 'files.stateSaved',
  saving: 'files.stateSaving',
  full: 'files.stateFull',
  'files-only': 'files.stateFilesOnly',
  error: 'files.stateError',
};

export function SaveStatus({ state: given, className }: { state?: SaveState; className?: string }) {
  const current = useSaveState();
  const state = given ?? current;
  const warn = state === 'full' || state === 'files-only' || state === 'error';
  const said = useRef<SaveState | null>(null);

  useEffect(() => {
    const before = said.current;
    said.current = state;
    // Announce the first save and every failure; not each routine save.
    if (before === null) return;
    if (warn && before !== state) announce(t(STATE_TEXT[state]), 'polite');
    else if (state === 'saved' && before !== 'saved' && before !== 'saving') announce(t(STATE_TEXT[state]), 'polite');
  }, [state, warn]);

  return (
    <span className={cx('save-state', `save-state--${state}`, warn && 'save-state--warn', className)} data-testid="save-state" data-state={state}>
      {warn ? <Icon name="warning" size={18} /> : <span className="save-state__dot" aria-hidden="true" />}
      <span>{t(STATE_TEXT[state])}</span>
    </span>
  );
}
