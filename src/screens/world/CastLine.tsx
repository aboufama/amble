/**
 * The Cast line (§2.6): the drawings this world needs, hero first, as a pane of tiles under the world (the
 * look of Scratch's sprite pane). A drawn tile opens a menu (Redraw, Bones, Rename, Moves, Save to My
 * characters, Save as picture); a tile still to draw lifts onto the Desk; the dashed tile adds someone.
 * One tile at a time carries the purple selection: the one whose menu is open, else the thing chosen in
 * Change mode, else the one Amble wants drawn next. In the small layout the line becomes a "Cast 4/6"
 * button with a bottom sheet.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { navigate } from '../../app/router';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import type { CastMember, World } from '../../model/types';
import { showToast } from '../../state/app';
import { useStore } from '../../state/store';
import { askUser } from '../../ui/dialogs';
import { Button, Popover, Sheet } from '../../ui/components';
import { Icon, type IconName } from '../../ui/icons';
import { rovingIndex, useReducedMotion } from '../../ui/a11y';
import { castProgress, nextNeeded } from '../../world/cast';
import { askBusy, runAsk } from '../../world/ask';
import { AddCard, CastCard, pronounWord } from './CastCard';
import { useAiOn, useLayout } from './hooks';

interface MenuAction {
  id: string;
  label: string;
  icon: IconName;
  run(): void;
}

function CardMenu({ member, anchor, actions, onClose }: { member: CastMember; anchor: HTMLElement; actions: MenuAction[]; onClose(): void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(0);
  const onKey = (e: KeyboardEvent) => {
    const next = rovingIndex(e.key, active, actions.length, 'vertical');
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  };
  return (
    <Popover open anchor={anchor} onClose={onClose} label={t('world.cardMenu', { name: member.name })} placement="top" className="cast-menu">
      <div role="menu" aria-label={t('world.cardMenu', { name: member.name })} onKeyDown={onKey} className="cast-menu__list">
        {actions.map((a, i) => (
          <button
            key={a.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="menuitem"
            tabIndex={i === active ? 0 : -1}
            className="menu__item"
            onClick={() => {
              onClose();
              a.run();
            }}
          >
            <Icon name={a.icon} size={20} />
            <span className="menu__label">{a.label}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

/**
 * Whether cards are out of view at either end of the line. A wheel that only scrolls up and down (a mouse)
 * scrolls the line sideways; keyboard users reach every card by Tab, which scrolls it into view.
 */
function useHiddenEnds(ref: RefObject<HTMLUListElement | null>, count: number): { before: boolean; after: boolean } {
  const [ends, setEnds] = useState({ before: false, after: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      const next = { before: el.scrollLeft > 2, after: el.scrollLeft < max - 2 };
      setEnds((was) => (was.before === next.before && was.after === next.after ? was : next));
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += e.deltaY;
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      el.removeEventListener('wheel', onWheel);
      ro.disconnect();
    };
  }, [ref, count]);
  return ends;
}

export interface CastLineProps {
  world: World;
  /** Lift a member onto the Desk from its card. */
  onDraw(member: CastMember, from: HTMLElement): void;
  onAdd(from: HTMLElement): void;
}

export function CastLine({ world, onDraw, onAdd }: CastLineProps) {
  const { store, files } = useServices();
  const cast = useStore((s) => s.session.cast);
  const fresh = useStore((s) => s.session.fresh);
  const selected = useStore((s) => s.session.selected);
  const aiOn = useAiOn(world.assignment);
  const layout = useLayout();
  const [menu, setMenu] = useState<{ member: CastMember; anchor: HTMLElement } | null>(null);
  const [sheet, setSheet] = useState(false);
  const row = useRef<HTMLUListElement>(null);
  const reduced = useReducedMotion();
  const ends = useHiddenEnds(row, layout === 'small' ? 0 : cast.length);
  const page = (dir: 1 | -1) => {
    const el = row.current;
    if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth - 140), behavior: reduced ? 'auto' : 'smooth' });
  };
  const progress = castProgress(cast);
  const turnKey = nextNeeded(cast)?.key ?? null;
  const chosen = selected && cast.some((m) => m.key === selected) ? selected : null;
  const pickedKey = menu?.member.key ?? chosen ?? turnKey;

  const rename = async (m: CastMember) => {
    if (!m.art) return;
    const record = await store.art.get(m.art);
    if (!record) return;
    const name = await askUser({ title: t('world.castRenameTitle', { name: m.name }), label: t('world.castRenameLabel'), value: record.name, maxLength: 40 });
    const next = name?.trim();
    if (!next || next === record.name) return;
    await store.commit({ art: [{ ...record, name: next, updatedAt: Date.now() }] });
  };

  const shelve = async (m: CastMember) => {
    if (!m.art) return;
    const record = await store.art.get(m.art);
    if (!record) return;
    await store.commit({ art: [{ ...record, shelf: true, updatedAt: Date.now() }] });
    showToast(t('world.castSavedCharacter', { name: record.name || m.name }), { kind: 'success' });
  };

  const actionsFor = (m: CastMember, el: HTMLElement): MenuAction[] => {
    const list: MenuAction[] = [{ id: 'redraw', label: t('world.castRedraw'), icon: 'draw', run: () => onDraw(m, el) }];
    if (m.kind === 'character' && m.rig !== 'none') {
      list.push({ id: 'bones', label: t('world.castBones'), icon: 'bones', run: () => navigate({ name: 'bones', worldId: world.id, key: m.key }) });
    }
    list.push({ id: 'rename', label: t('world.castRename'), icon: 'pencil', run: () => void rename(m) });
    if (m.kind === 'character' && m.rig !== 'none') {
      list.push({ id: 'moves', label: t('world.castMoves'), icon: 'play', run: () => navigate({ name: 'bones', worldId: world.id, key: m.key }) });
    }
    list.push({ id: 'shelf', label: t('world.castSaveCharacter'), icon: 'star', run: () => void shelve(m) });
    list.push({
      id: 'picture',
      label: t('world.castSavePicture'),
      icon: 'fileSave',
      run: () => {
        if (m.art) void files.savePicture(m.art).catch(() => showToast(t('world.castPictureFailed'), { kind: 'error' }));
      },
    });
    if (m.status === 'resting' && aiOn) {
      const pronoun = pronounWord(m.pronoun);
      list.push({
        id: 'ask',
        label: t('world.askToAdd', { pronoun }),
        icon: 'plus',
        run: () => {
          if (!askBusy()) void runAsk('change', t('world.addRequestPlain', { name: m.name, role: m.role }));
        },
      });
    }
    return list;
  };

  const press = (m: CastMember, el: HTMLElement) => {
    if (m.status === 'drawn' || m.status === 'resting') setMenu({ member: m, anchor: el });
    else onDraw(m, el);
  };

  const head = (
    <div className="cast-line__head">
      <h2 className="cast-line__title">{t('world.castTitle')}</h2>
      <p className="cast-line__progress" aria-live="polite">
        {!cast.length ? t('world.castEmpty') : progress.allRequired ? t('world.castAllDrawn') : t('world.castProgress', { drawn: progress.drawn, total: progress.total })}
      </p>
      {cast.length > 0 && <p className="cast-line__tap">{t('world.castTap')}</p>}
    </div>
  );

  const list = (
    <ul ref={row} className="cast-line__cards" aria-label={t('world.castLabel')}>
      {cast.map((m) => (
        <CastCard key={m.key} member={m} turn={m.key === turnKey} picked={m.key === pickedKey} fresh={fresh.includes(m.key)} onPress={press} />
      ))}
      <AddCard onPress={onAdd} />
    </ul>
  );

  if (layout === 'small') {
    return (
      <section className="cast-line cast-line--button" data-region="cast" aria-label={t('world.castLabel')} data-testid="cast-line">
        <Button variant="ghost" icon="list" onClick={() => setSheet(true)} data-testid="cast-open">
          {`${t('world.castTitle')} ${progress.drawn}/${progress.total}`}
        </Button>
        <Sheet open={sheet} onClose={() => setSheet(false)} title={t('world.castTitle')} side="bottom">
          <div className="cast-line cast-line--sheet">
            {head}
            {list}
          </div>
        </Sheet>
        {menu && <CardMenu member={menu.member} anchor={menu.anchor} actions={actionsFor(menu.member, menu.anchor)} onClose={() => setMenu(null)} />}
      </section>
    );
  }

  return (
    <section className="cast-line" data-region="cast" aria-label={t('world.castLabel')} data-testid="cast-line">
      {head}
      {list}
      {/* For the pointer only (the cards themselves are all reachable by Tab). */}
      {ends.before && (
        <button type="button" className="cast-line__more cast-line__more--before" tabIndex={-1} aria-hidden="true" title={t('world.castMore')} onClick={() => page(-1)}>
          <Icon name="back" size={20} />
        </button>
      )}
      {ends.after && (
        <button type="button" className="cast-line__more cast-line__more--after" tabIndex={-1} aria-hidden="true" title={t('world.castMore')} onClick={() => page(1)} data-testid="cast-more">
          <Icon name="back" size={20} />
        </button>
      )}
      {menu && <CardMenu member={menu.member} anchor={menu.anchor} actions={actionsFor(menu.member, menu.anchor)} onClose={() => setMenu(null)} />}
    </section>
  );
}
