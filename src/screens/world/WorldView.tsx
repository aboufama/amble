/**
 * The world view (§2.6): where the running game shows (the PlayerLayer's iframe is placed over the slot),
 * with the editor's overlays above it, never inside the frame: the Loading picture, "The world stopped.",
 * the AI progress pill, the request tag and coach mark, the problem card, the new-version card, the steer
 * toast, Change mode's layer, the game's captions and text mirror, and the Exit button in full screen.
 */
import { forwardRef, useEffect, useState, type ReactNode, type RefObject } from 'react';
import { GameAccess } from '../../app/player/GameAccess';
import { t } from '../../i18n';
import type { CastMember, World } from '../../model/types';
import { useStore } from '../../state/store';
import { Button, Footprints } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import type { Box } from '../../world/objects';
import { SteerToastHost } from '../ai/SteerToast';
import { ChangeLayer } from './ChangeLayer';
import { NewVersionCard } from './NewVersionCard';
import { ProblemCard } from './ProblemCard';
import { CoachMark, RequestTag } from './RequestTag';

function Loading({ title }: { title: string }) {
  const ready = useStore((s) => s.session.ready);
  const snapshot = useStore((s) => s.session.snapshot);
  if (ready) return null;
  return (
    <div className="world-view__loading" data-testid="world-loading">
      {snapshot && <img src={snapshot} alt="" className="world-view__snapshot" />}
      <span className="world-view__loading-note">
        <Footprints label={t('world.loading', { title })} />
      </span>
    </div>
  );
}

function Stopped({ onRestart }: { onRestart(): void }) {
  const stopped = useStore((s) => s.session.stopped);
  if (stopped !== 'crashed') return null;
  return (
    <div className="world-view__stopped paper paper--cut on-paper" role="alert" data-testid="world-stopped">
      <p className="world-view__stopped-title">{t('world.stoppedTitle')}</p>
      <Button variant="lantern" icon="restart" size={38} onClick={onRestart}>
        {t('world.restartIt')}
      </Button>
    </div>
  );
}

function Notices() {
  const stopped = useStore((s) => s.session.stopped);
  const heavy = useStore((s) => s.session.heavy);
  const [heavySeen, setHeavySeen] = useState(false);
  if (stopped === 'navigated') {
    return (
      <p className="world-view__notice" role="status">
        <Icon name="info" size={18} />
        {t('world.navigated')}
      </p>
    );
  }
  if (heavy && !heavySeen) {
    return (
      <button type="button" className="world-view__notice" onClick={() => setHeavySeen(true)} data-testid="world-heavy">
        <Icon name="info" size={18} />
        {t('world.heavy')}
      </button>
    );
  }
  return null;
}

/** The AI progress pill (top right, only while the AI helper works on this world). */
function AiPill({ world }: { world: World }) {
  const job = useStore((s) => (s.ai.job?.worldId === world.id ? s.ai.job : null));
  // Only while a job really runs: a Warm-up whose build was stopped is not "Building…" (it builds again
  // the next time the world opens).
  if (!job) return null;
  const text = job.task === 'build' ? t('world.pillBuilding', { title: world.title }) : t('world.pillWorking');
  return (
    <p className="ai-pill" role="status" data-testid="ai-pill">
      <Footprints label={text} />
      <span>{text}</span>
    </p>
  );
}

/** The cards at the bottom of the world view, which captions stay above. */
const BOTTOM_CARDS = '.request-tag, .problem-card, .new-version, .ai-steer';

export interface WorldViewProps {
  world: World;
  slotRef: RefObject<HTMLDivElement | null>;
  frame: DOMRect | null;
  fullscreen: boolean;
  pointerGame: boolean;
  onRestart(): void;
  onReload(): void;
  onExitFullscreen(): void;
  onDraw(member: CastMember, from?: HTMLElement | DOMRect): void;
  onBones(member: CastMember): void;
  /** Where a member stands now, in world view px (null when it is not on screen). */
  locate(key: string): Promise<Box | null>;
  children?: ReactNode;
}

export const WorldView = forwardRef<HTMLDivElement, WorldViewProps>(function WorldView(
  { world, slotRef, frame, fullscreen, pointerGame, onRestart, onReload, onExitFullscreen, onDraw, onBones, locate },
  ref,
) {
  const mode = useStore((s) => s.session.mode);
  const [exitFaded, setExitFaded] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    setExitFaded(false);
    const timer = setTimeout(() => setExitFaded(true), 3000);
    return () => clearTimeout(timer);
  }, [fullscreen]);

  return (
    <div ref={ref} className={cx('world-view', mode === 'change' && 'world-view--change')} data-testid="world-view">
      <div ref={slotRef} id="game" className="world-view__slot" role="region" tabIndex={-1} aria-label={t('world.worldRegion', { title: world.title })} data-testid="world-slot" />
      <Loading title={world.title} />
      <Notices />
      <AiPill world={world} />
      {mode === 'play' && (
        <>
          <RequestTag onDraw={(m, el) => onDraw(m, el)} />
          <CoachMark pointer={pointerGame} frame={frame} locate={locate} />
          <NewVersionCard />
          <div className="world-view__steer">
            <SteerToastHost worldId={world.id} />
          </div>
        </>
      )}
      {mode === 'change' && frame && <ChangeLayer frame={frame} onDraw={(m) => onDraw(m)} onBones={onBones} />}
      {/* Above Change mode's veil, so a broken or stopped world can be fixed from either mode. */}
      <ProblemCard world={world} onRestart={onRestart} />
      <Stopped onRestart={onReload} />
      <GameAccess avoid={BOTTOM_CARDS} />
      {fullscreen && (
        <Button
          variant="ghost"
          icon="close"
          className={cx('world-view__exit', exitFaded && 'world-view__exit--faded')}
          onClick={onExitFullscreen}
          onFocus={() => setExitFaded(false)}
          data-testid="world-exit-fullscreen"
        >
          {t('world.exitFullscreen')}
        </Button>
      )}
    </div>
  );
});
