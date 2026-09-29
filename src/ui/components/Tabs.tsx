/**
 * Tabs (§3.4; only in the Teacher desk and Settings): a tablist with roving focus. Render each panel with
 * `TabPanel` and the same `idPrefix`.
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { cx } from '../cx';
import { rovingIndex } from '../a11y';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon?: IconName;
}

export interface TabsProps<T extends string> {
  label: string;
  tabs: TabDef<T>[];
  value: T;
  onChange(id: T): void;
  idPrefix: string;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

export function Tabs<T extends string>({ label, tabs, value, onChange, idPrefix, orientation = 'horizontal', className }: TabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(0, tabs.findIndex((tab) => tab.id === value));
  const onKey = (e: KeyboardEvent) => {
    const next = rovingIndex(e.key, index, tabs.length, orientation);
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} aria-orientation={orientation} className={cx('tabs', `tabs--${orientation}`, className)} onKeyDown={onKey}>
      {tabs.map((tab, i) => {
        const on = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            aria-selected={on}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={on ? 0 : -1}
            className={cx('tabs__tab', on && 'tabs__tab--on')}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon && <Icon name={tab.icon} size={20} />}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idPrefix, id, children, className }: { idPrefix: string; id: string; children?: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${id}`} aria-labelledby={`${idPrefix}-tab-${id}`} tabIndex={0} className={cx('tab-panel', className)}>
      {children}
    </div>
  );
}
