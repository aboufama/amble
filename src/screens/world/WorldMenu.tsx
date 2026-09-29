/**
 * The world's ⋯ menu (§2.6): Look inside, Sounds, Controls, Problems (n), Share as a web page, Make a
 * copy, World info, Save to Drive (or Hand in), Help, and "Last saved to Drive 10:42".
 */
import { useEffect, useRef, useState } from 'react';
import { useCommand } from '../../app/keys';
import { navigate } from '../../app/router';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { uid } from '../../model/ids';
import type { World } from '../../model/types';
import type { Store } from '../../store/api';
import { showToast } from '../../state/app';
import { flushWorld } from '../../state/session';
import { copyDrawings, copyStrokeLogs } from '../../world/copy';
import { getState, useStore } from '../../state/store';
import { Menu, type MenuItem } from '../../ui/components';
import { saveWorldToDrive } from '../files/SaveButton';

export type SheetName = 'sounds' | 'controls' | 'problems' | 'info' | null;

export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** A copy of a world under a new id, with its own first footstep (its drawings come from `copyDrawings`). */
export function copyOf(world: World, now = Date.now()): World {
  const title = t('world.copyTitle', { title: world.title }).slice(0, 40);
  const start = { id: uid('s_'), at: now, by: 'student' as const, kind: 'start' as const, text: t('world.copyStep', { title: world.title }) };
  return {
    ...structuredClone(world),
    id: uid('w_'),
    title,
    createdAt: now,
    updatedAt: now,
    openedAt: now,
    steps: [start],
    head: start.id,
    handIn: { fileName: null, savedAt: null, method: null, turnedInAt: null },
  };
}

/**
 * Make a copy (§2.6): the copy with its own drawings (drawing one again there never changes this world's; the
 * pictures themselves are shared), in one commit. Returns the copy.
 */
export async function saveCopy(store: Store, world: World): Promise<World> {
  const drawings = await copyDrawings(store, world.cast);
  const next = { ...copyOf(world), cast: drawings.cast };
  await store.commit({ art: drawings.art, worlds: [next] });
  await copyStrokeLogs(store, drawings.ids);
  return next;
}

export function WorldMenu({ world, onOpen }: { world: World; onOpen(sheet: SheetName): void }) {
  const { files, store } = useServices();
  const problems = useStore((s) => s.session.problems.length);
  const [lastSaved, setLastSaved] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void files
      .lastSaved(world.id)
      .then((saved) => {
        if (live) setLastSaved(saved?.at ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [files, world.id, world.updatedAt]);

  const share = async () => {
    try {
      const saved = await files.saveSharePage(world);
      if (saved) showToast(t('world.shareSaved', { name: saved.name }), { kind: 'success' });
    } catch (err) {
      console.warn('Share as a web page failed:', err);
      showToast(t('world.shareFailed'), { kind: 'error' });
    }
  };

  const copy = async () => {
    try {
      await flushWorld();
      const next = await saveCopy(store, world);
      showToast(t('world.copyMade', { title: next.title }), { kind: 'success' });
      navigate({ name: 'world', id: next.id });
    } catch (err) {
      console.warn('Make a copy failed:', err);
      showToast(t('world.copyFailed'), { kind: 'error' });
    }
  };

  const saving = useRef(false);
  const saveToDrive = async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      await flushWorld();
      const open = getState().session.world;
      await saveWorldToDrive(files, open?.id === world.id ? open : world);
    } finally {
      saving.current = false;
    }
  };
  // Hand in has the top bar's place in an assignment's world: Ctrl+S still saves it to Drive (§2.2).
  useCommand(
    'save',
    () => {
      void saveToDrive();
    },
    !!world.assignment,
  );

  const items: MenuItem[] = [
    { id: 'code', label: t('world.menuLookInside'), icon: 'eye', onSelect: () => navigate({ name: 'code', worldId: world.id, file: null }) },
    { id: 'sounds', label: t('world.menuSounds'), icon: 'sound', onSelect: () => onOpen('sounds') },
    { id: 'controls', label: t('world.menuControls'), icon: 'settings', onSelect: () => onOpen('controls') },
    {
      id: 'problems',
      label: problems ? t('world.menuProblemsCount', { n: problems }) : t('world.menuProblems'),
      icon: 'warning',
      onSelect: () => onOpen('problems'),
    },
    { id: 'share', label: t('world.menuShare'), icon: 'fileSave', onSelect: () => void share() },
    { id: 'copy', label: t('world.menuCopy'), icon: 'plus', onSelect: () => void copy() },
    { id: 'info', label: t('world.menuInfo'), icon: 'info', onSelect: () => onOpen('info') },
    world.assignment
      ? { id: 'drive', label: t('files.saveToDrive'), icon: 'drive', onSelect: () => void saveToDrive() }
      : { id: 'handin', label: t('common.routeHandin'), icon: 'handIn', onSelect: () => navigate({ name: 'handin', worldId: world.id }) },
    { id: 'help', label: t('world.menuHelp'), icon: 'info', onSelect: () => navigate({ name: 'page', page: 'poster' }) },
  ];
  if (lastSaved) items.push({ id: 'saved', label: t('world.lastSavedDrive', { time: clockTime(lastSaved) }), icon: 'check', disabled: true, onSelect: () => undefined });

  return <Menu label={t('world.menuLabel')} icon="more" items={items} variant="quiet" className="world-top__more" />;
}
