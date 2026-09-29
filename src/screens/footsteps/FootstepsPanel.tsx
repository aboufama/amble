/**
 * Footsteps (§2.9): the notebook's lower panel. Every change to the world is a step on a dotted trail,
 * newest first; hovering or focusing a step offers ↺ Go back to this step, which adds a step (nothing is
 * ever deleted). AI steps show the student's words and See the change. The newest 60 steps are listed;
 * older ones fold into "Earlier (n)". Keyboard: the list is one tab stop, ↑ ↓ Home End move between
 * steps, Tab reaches the focused step's buttons.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useServices } from '../../app/services';
import { canGoBack } from '../../history/goBack';
import { isOpenWorld, playWorld } from '../../history/live';
import { foldedSteps } from '../../history/prune';
import { parentOf } from '../../history/record';
import { t } from '../../i18n';
import { KEEP } from '../../model/limits';
import type { StepId, StepSummary, World, WorldId } from '../../model/types';
import { announce, showToast } from '../../state/app';
import { Panel } from '../../ui/components';
import { focusElement, rovingIndex, useReducedMotion } from '../../ui/a11y';
import { cx } from '../../ui/cx';
import { playUiSound } from '../../ui/sounds';
import { DiffSheet } from './DiffSheet';
import { FootstepItem } from './FootstepItem';
import { onSeeChange } from './seeChange';
import { useFootstepsWorld, useNow } from './useFootsteps';
import './footsteps.css';

export interface FootstepsPanelProps {
  worldId: WorldId;
  compact?: boolean;
}

/** Height of the bottom band the "13 more steps ▾" button and its fade cover. */
const MORE_BUTTON_ZONE = 34;

/** Counts the steps below the visible part of the list (for "13 more steps ▾"); `layout` re-measures. */
function useMoreBelow(scroller: RefObject<HTMLDivElement | null>, layout: string): number {
  const [below, setBelow] = useState(0);
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    // Steps not fully above the "more steps" button at the bottom count as hidden.
    const bottom = el.getBoundingClientRect().bottom - MORE_BUTTON_ZONE;
    let n = 0;
    for (const li of el.querySelectorAll<HTMLElement>('.step')) if (li.getBoundingClientRect().bottom > bottom) n++;
    setBelow(n);
  }, [scroller]);
  useLayoutEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [measure, layout]);
  return below;
}

function Trail({ world, compact }: { world: World; compact: boolean }) {
  const { history } = useServices();
  const now = useNow();
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<StepSummary | null>(null);
  const [fresh, setFresh] = useState<StepId | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<StepId, HTMLLIElement>());
  const lastHead = useRef(world.head);

  const ordered = useMemo(() => [...world.steps].reverse(), [world.steps]);
  const folded = useMemo(() => foldedSteps(world.steps), [world.steps]);
  const recent = ordered.slice(0, KEEP.stepsPerWorld);
  const older = ordered.slice(KEEP.stepsPerWorld);
  const shown = earlierOpen ? ordered : recent;
  const headId = ordered[0]?.id ?? null;
  const below = useMoreBelow(scroller, `${shown.length}:${compact}:${earlierOpen}:${world.head}`);

  // A new step prints its footprint (and the step sound) when it arrives.
  useEffect(() => {
    if (world.head === lastHead.current) return;
    lastHead.current = world.head;
    setFresh(world.head);
    setActive(0);
    playUiSound('step');
    scroller.current?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    const id = setTimeout(() => setFresh(null), 700);
    return () => clearTimeout(id);
  }, [world.head, reduced]);

  useEffect(
    () =>
      onSeeChange((worldId, stepId) => {
        if (worldId !== world.id) return;
        const step = world.steps.find((s) => s.id === stepId);
        if (step) setSheet(step);
      }),
    [world],
  );

  const goBack = async (to: StepSummary) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await history.goBack(world, to.id);
      setSheet(null);
      announce(next.steps[next.steps.length - 1].text);
      // The world went back as soon as it is saved. The game restarts beside it (a failed start shows on
      // the world's problem card, and another Go back simply replaces this load).
      if (isOpenWorld(world.id)) void playWorld(next).catch(() => undefined);
    } catch {
      showToast(t('history.goBackFailed'), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const focusStep = (index: number) => {
    const step = shown[index];
    if (!step) return;
    setActive(index);
    focusElement(items.current.get(step.id));
    items.current.get(step.id)?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (index: number) => (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget) return;
    const next = rovingIndex(e.key, index, shown.length, 'vertical', false);
    if (next === null) return;
    e.preventDefault();
    focusStep(next);
  };

  const scrollMore = () => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ top: el.clientHeight * 0.8, behavior: reduced ? 'auto' : 'smooth' });
  };

  const sheetParent = sheet ? parentOf(world, sheet.id) : null;

  return (
    <>
      <div className={cx('footsteps__scroller', below > 0 && 'footsteps__scroller--more')} ref={scroller}>
        <ol className="footsteps__trail" aria-label={t('history.listLabel')}>
          {shown.map((step, i) => (
            <FootstepItem
              key={step.id}
              step={step}
              now={now}
              isNow={step.id === headId}
              canGoBack={step.id !== headId && !folded.has(step.id)}
              folded={folded.has(step.id)}
              tabbable={i === Math.min(active, shown.length - 1)}
              fresh={fresh === step.id}
              compact={compact}
              busy={busy}
              itemRef={(el) => {
                if (el) items.current.set(step.id, el);
                else items.current.delete(step.id);
              }}
              onFocusStep={() => setActive(i)}
              onKeyDown={onKeyDown(i)}
              onGoBack={() => void goBack(step)}
              onSeeChange={() => setSheet(step)}
            />
          ))}
        </ol>
        {world.steps.length === 1 && <p className="footsteps__empty">{t('history.emptyHint')}</p>}
        {older.length > 0 && (
          <button type="button" className="footsteps__earlier" aria-expanded={earlierOpen} onClick={() => setEarlierOpen((v) => !v)}>
            {earlierOpen ? t('history.hideEarlier') : t('history.earlier', { n: older.length })} {earlierOpen ? '▴' : '▾'}
          </button>
        )}
      </div>
      {below > 0 && (
        <button type="button" className="footsteps__more" onClick={scrollMore}>
          {below === 1 ? t('history.moreStep') : t('history.moreSteps', { n: below })} ▾
        </button>
      )}
      <DiffSheet
        world={world}
        step={sheet}
        busy={busy}
        canGoBackBefore={!!sheetParent && canGoBack(world, sheetParent.id)}
        onClose={() => setSheet(null)}
        onGoBackBefore={(step) => {
          const parent = parentOf(world, step.id);
          if (parent) void goBack(parent);
        }}
      />
    </>
  );
}

export function FootstepsPanel({ worldId, compact = false }: FootstepsPanelProps) {
  const { history } = useServices();
  const { world, loading } = useFootstepsWorld(worldId);
  const headId = world?.head ?? null;
  const ensured = useRef<string | null>(null);

  // Worlds are born without a snapshot of their first step: make one as soon as the panel sees the world.
  useEffect(() => {
    if (!world || !headId || ensured.current === `${world.id}:${headId}`) return;
    ensured.current = `${world.id}:${headId}`;
    void history.ensureHead(world).catch(() => undefined);
  }, [world, headId, history]);

  return (
    <Panel
      title={t('history.title')}
      className={cx('footsteps', compact && 'footsteps--compact')}
      actions={<span className="footsteps__hint">{t('history.hint')}</span>}
    >
      {world ? (
        <Trail world={world} compact={compact} />
      ) : (
        <div className="footsteps__loading" aria-busy={loading}>
          <span className="sr-only">{t('history.loading')}</span>
          {[0, 1, 2].map((i) => (
            <span key={i} className="footsteps__ghost" aria-hidden="true" />
          ))}
        </div>
      )}
    </Panel>
  );
}
