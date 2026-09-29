/**
 * **Name: Blorp ✎** (§2.3): the creature's name, edited in place (24 characters; Enter keeps it, Esc
 * puts the old one back).
 */
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { Icon } from '../../ui/icons';
import { cleanName } from './names';

export function NameChip({ name, onRename }: { name: string; onRename(name: string): void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const done = useRef(false);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (keep) {
      const next = cleanName(draft, name);
      if (next !== name) onRename(next);
    }
    requestAnimationFrame(() => button.current?.focus({ preventScroll: true }));
  };

  if (editing) {
    return (
      <span className="first-name first-name--editing">
        <span aria-hidden="true">{t('home.nameLabel')}</span>
        <input
          ref={input}
          className="first-name__input"
          value={draft}
          maxLength={24}
          aria-label={t('home.nameField', { name })}
          aria-describedby="name-chip-hint"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              finish(true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              finish(false);
            }
          }}
          onBlur={() => finish(true)}
          data-testid="name-input"
        />
        <span id="name-chip-hint" className="sr-only">
          {t('home.nameHint')}
        </span>
      </span>
    );
  }

  return (
    <button
      ref={button}
      type="button"
      className="first-name"
      aria-label={t('home.nameEdit', { name })}
      onClick={() => {
        done.current = false;
        setDraft(name);
        setEditing(true);
      }}
      data-testid="name-chip"
    >
      <span>
        {t('home.nameLabel')} <b>{name}</b>
      </span>
      <Icon name="draw" size={18} />
    </button>
  );
}
