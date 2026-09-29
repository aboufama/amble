/**
 * A world sign's menu (§2.4): **Open**, **Rename**, **Make a copy**, **Save to Drive**, **Put away**.
 * Opened with Shift+F10, the context-menu key, a right click or a long press on the sign. Arrow keys move
 * between the items; Esc closes it and focus goes back to the sign.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { navigate } from '../../app/router';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { copyWorld, renameWorld, TITLE_MAX } from '../../home/createWorld';
import type { WorldMeta } from '../../model/types';
import { showToast } from '../../state/app';
import { refreshLibrary } from '../../state/library';
import { rovingIndex } from '../../ui/a11y';
import { Popover } from '../../ui/components';
import { askUser, confirmUser } from '../../ui/dialogs';
import { Icon, type IconName } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { playUiSound } from '../../ui/sounds';

export interface SignMenuProps {
  meta: WorldMeta | null;
  anchor: HTMLElement | null;
  onClose(): void;
}

interface Item {
  id: string;
  label: string;
  icon: IconName;
  danger?: boolean;
  run(): void | Promise<void>;
}

export function SignMenu({ meta, anchor, onClose }: SignMenuProps) {
  const { store, files } = useServices();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(0);
  const open = Boolean(meta && anchor);

  useEffect(() => {
    if (!open) return;
    playUiSound('paper');
    setActive(0);
  }, [open]);

  useEffect(() => {
    if (open) refs.current[active]?.focus();
  }, [open, active]);

  if (!meta) return null;
  const title = meta.title;

  const items: Item[] = [
    { id: 'open', label: t('home.menuOpen'), icon: 'play', run: () => navigate({ name: 'world', id: meta.id }) },
    {
      id: 'rename',
      label: t('home.menuRename'),
      icon: 'draw',
      run: async () => {
        const next = await askUser({ title: t('home.renameTitle', { title }), label: t('home.renameField'), value: title, maxLength: TITLE_MAX, ok: t('home.renameOk') });
        if (next !== null) await renameWorld(meta.id, next);
      },
    },
    {
      id: 'copy',
      label: t('home.menuCopy'),
      icon: 'plus',
      run: async () => {
        const copy = await copyWorld(meta.id);
        if (copy) showToast(t('home.copied', { title: copy.title }), { kind: 'success' });
      },
    },
    {
      id: 'save',
      label: t('home.menuSave'),
      icon: 'drive',
      run: async () => {
        const world = await store.worlds.get(meta.id);
        if (world) await files.saveWorld(world);
      },
    },
    {
      id: 'putAway',
      label: t('home.menuPutAway'),
      icon: 'close',
      danger: true,
      run: async () => {
        const ok = await confirmUser({ title: t('home.putAwayTitle', { title }), ok: t('home.putAwayOk'), cancel: t('common.cancel') });
        if (!ok) return;
        await store.worlds.putAway(meta.id);
        await refreshLibrary(store);
        showToast(t('home.putAwayDone', { title }), {
          action: {
            label: t('home.bringItBack'),
            run: () =>
              void store.worlds
                .restore(meta.id)
                .then(() => refreshLibrary(store))
                .catch(() => undefined),
          },
        });
      },
    },
  ];

  const pick = (item: Item) => {
    onClose();
    void Promise.resolve(item.run()).catch((err: unknown) => {
      console.warn('The sign menu action failed:', err);
      showToast(err instanceof Error && err.message ? err.message : t('home.couldNotSave'), { kind: 'error' });
    });
  };

  const onKey = (e: KeyboardEvent) => {
    const next = rovingIndex(e.key, active, items.length, 'vertical');
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  return (
    <Popover open={open} anchor={anchor} onClose={onClose} label={t('home.signMenu', { title })} placement="top" className="sign-menu">
      <div role="menu" aria-label={t('home.signMenu', { title })} onKeyDown={onKey}>
        {items.map((item, i) => (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="menuitem"
            tabIndex={i === active ? 0 : -1}
            className={cx('menu__item', item.danger && 'menu__item--danger')}
            onClick={() => pick(item)}
            data-testid={`sign-menu-${item.id}`}
          >
            <Icon name={item.icon} size={20} />
            <span className="menu__label">{item.label}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}
