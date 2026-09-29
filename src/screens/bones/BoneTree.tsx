/**
 * The bone list (§2.11, §3.9): a `role="tree"` that mirrors the bone tree (the hips hold the body, the
 * body holds the neck and the arms…). It is visually hidden until it has focus, then it shows itself as
 * a card in the sky, so keyboard users can see where they are. Up and Down pick a bone, Right and Left
 * go to a bone's first child or its parent, Home and End jump, Enter opens the bone's card.
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { RigData } from '../../cores/rig';
import { boneListName } from '../../bones/words';
import { t } from '../../i18n';
import { cx } from '../../ui/cx';

export interface BoneTreeProps {
  rig: RigData;
  name: string;
  onOpen(index: number): void;
}

interface TreeNode {
  index: number;
  level: number;
  children: number[];
  parent: number;
}

/** Bones in tree order (depth first, parents before children), with their levels. */
export function treeOrder(rig: RigData): TreeNode[] {
  const kids = new Map<number, number[]>();
  rig.bones.forEach((b, i) => {
    const list = kids.get(b.parent) ?? [];
    list.push(i);
    kids.set(b.parent, list);
  });
  const out: TreeNode[] = [];
  const walk = (i: number, level: number) => {
    out.push({ index: i, level, children: kids.get(i) ?? [], parent: rig.bones[i].parent });
    for (const c of kids.get(i) ?? []) walk(c, level + 1);
  };
  for (const root of kids.get(-1) ?? []) walk(root, 1);
  return out;
}

export function BoneTree({ rig, name, onOpen }: BoneTreeProps) {
  const nodes = useMemo(() => treeOrder(rig), [rig]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const items = useRef<Array<HTMLLIElement | null>>([]);
  const titleId = useId();
  const at = Math.min(active, nodes.length - 1);

  const go = (pos: number) => {
    const p = Math.max(0, Math.min(nodes.length - 1, pos));
    setActive(p);
    items.current[p]?.focus({ preventScroll: true });
  };

  const onKey = (e: KeyboardEvent<HTMLLIElement>, pos: number) => {
    const node = nodes[pos];
    let handled = true;
    switch (e.key) {
      case 'ArrowDown':
        go(pos + 1);
        break;
      case 'ArrowUp':
        go(pos - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(nodes.length - 1);
        break;
      case 'ArrowRight': {
        const child = node.children[0];
        if (child !== undefined) go(nodes.findIndex((n) => n.index === child));
        break;
      }
      case 'ArrowLeft': {
        if (node.parent >= 0) go(nodes.findIndex((n) => n.index === node.parent));
        break;
      }
      case 'Enter':
      case ' ':
        onOpen(node.index);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // one flat list of items with aria-level: the same tree for screen readers, and simple to keep in order
  return (
    <div
      className={cx('bone-tree', open && 'bone-tree--open')}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <p id={titleId} className="bone-tree__title">
        {t('bones.treeTitle', { n: rig.bones.length })}
        <span className="bone-tree__hint">{t('bones.treeHint')}</span>
      </p>
      <ul role="tree" aria-label={t('bones.treeLabel', { name })} className="bone-tree__list">
        {nodes.map((n, pos) => (
          <li
            key={rig.bones[n.index].name}
            ref={(el) => {
              items.current[pos] = el;
            }}
            role="treeitem"
            aria-level={n.level}
            aria-expanded={n.children.length ? true : undefined}
            aria-selected={pos === at}
            tabIndex={pos === at ? 0 : -1}
            className="bone-tree__item"
            style={{ paddingLeft: 10 + (n.level - 1) * 14 }}
            onKeyDown={(e) => onKey(e, pos)}
            onClick={() => {
              setActive(pos);
              onOpen(n.index);
            }}
          >
            {boneListName(rig, n.index)}
          </li>
        ))}
      </ul>
    </div>
  );
}
