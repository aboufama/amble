/**
 * The world view (§2.6): where the running game shows (the PlayerLayer's iframe is placed over the slot),
 * with the editor's overlays above it, never inside the frame: the Loading picture, "The world stopped.",
 * the AI progress pill, the request tag and coach mark, the problem card, the new-version card, the steer
 * toast, Change mode's layer, and the Exit button in full screen.
 */
import { forwardRef, useEffect, useState, type ReactNode, type RefObject } from 'react';
import { t } from '../../i18n';
import type { CastMember, World } from '../../model/types';
import { patchSession, setDial, setSteer, setTwist } from '../../state/session';
import { useStore } from '../../state/store';
import { Button, Footprints } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { runAsk } from '../../world/ask';
import type { Box } from '../../world/objects';
import { isWarmup } from '../../world/controller';
import { SteerToast } from '../ai/SteerToast';
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
  const warmup = isWarmup(world.code);
  if (!job && !warmup) return null;
  const text = job?.task === 'build' || (!job && warmup) ? t('world.pillBuilding', { title: world.title }) : t('world.pillWorking');
  return (
    <p className="ai-pill" role="status" data-testid="ai-pill">
      <Footprints label={text} />
      <span>{text}</span>
    </p>
  );
}

function Steer() {
  const steer = useStore((s) => s.session.steer);
  if (!steer) return null;
  return (
    <div className="world-view__steer">
      <SteerToast
        steer={steer.steer}
        onUndo={() => {
          const st = steer.steer;
          if (st.kind === 'dial') setDial(st.key, st.from);
          else setTwist(st.id, !st.on);
          setSteer(null);
        }}
        onAskAi={() => {
          setSteer(null);
          void runAsk('change', steer.words);
        }}
      />
    </div>
  );
}

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

  useEffect(() => {
    // A new game drops the old steer toast.
    return () => patchSession({ steer: null });
  }, [world.id]);

  return (
    <div ref={ref} className={cx('world-view', mode === 'change' && 'world-view--change')} data-testid="world-view">
      <div ref={slotRef} id="game" className="world-view__slot" tabIndex={-1} aria-label={t('world.worldRegion', { title: world.title })} data-testid="world-slot" />
      <Loading title={world.title} />
      <Stopped onRestart={onReload} />
      <Notices />
      <AiPill world={world} />
      {mode === 'play' && (
        <>
          <RequestTag onDraw={(m, el) => onDraw(m, el)} />
          <CoachMark pointer={pointerGame} frame={frame} locate={locate} />
          <NewVersionCard />
          <Steer />
        </>
      )}
      <ProblemCard world={world} onRestart={onRestart} />
      {mode === 'change' && frame && <ChangeLayer frame={frame} onDraw={(m) => onDraw(m)} onBones={onBones} />}
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
