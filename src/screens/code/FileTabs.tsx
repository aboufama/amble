/**
 * The world's code files as tabs (§2.12): game.js first, then its helpers; a ✎ badge on files the
 * student edited. A tablist with roving focus (← → Home End); the editor is the tab panel.
 */
import { useRef, type KeyboardEvent } from 'react';
import { t } from '../../i18n';
import { rovingIndex } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';

export interface FileTabsProps {
  files: Array<{ path: string; edited: boolean; dirty: boolean }>;
  active: string;
  panelId: string;
  onOpen(path: string): void;
}

export function tabId(path: string): string {
  return `code-tab-${path.replace(/[^a-z0-9]/gi, '-')}`;
}

export function FileTabs({ files, active, panelId, onOpen }: FileTabsProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const onKeyDown = (index: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = rovingIndex(e.key, index, files.length, 'horizontal');
    if (next === null) return;
    e.preventDefault();
    const path = files[next].path;
    onOpen(path);
    refs.current.get(path)?.focus();
  };
  return (
    <div className="code-tabs" role="tablist" aria-label={t('history.fileTabs')}>
      {files.map((f, i) => (
        <button
          key={f.path}
          ref={(el) => {
            if (el) refs.current.set(f.path, el);
            else refs.current.delete(f.path);
          }}
          type="button"
          role="tab"
          id={tabId(f.path)}
          aria-selected={f.path === active}
          aria-controls={panelId}
          tabIndex={f.path === active ? 0 : -1}
          className={cx('code-tab', f.path === active && 'code-tab--on')}
          onClick={() => onOpen(f.path)}
          onKeyDown={onKeyDown(i)}
        >
          <span className="code-tab__name">{f.path}</span>
          {f.edited && (
            <span className={cx('code-tab__edited', f.dirty && 'code-tab__edited--dirty')} title={t('history.editedFile')}>
              <Icon name="draw" size={14} />
              <span className="sr-only">{t('history.editedFile')}</span>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
