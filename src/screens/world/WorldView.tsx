/**
 * The world view (§2.6): where the running game shows (the PlayerLayer's iframe is placed over the slot),
 * with the editor's overlays above it, never inside the frame: the Loading picture, "The world stopped.",
 * the working line while a wish is worked on, the request tag and coach mark, the problem card, the
 * new-version card, the steer toast, the running-slowly notice, Change mode's layer, and the Exit button
 * in full screen.
 */
import { forwardRef, useEffect, useState, type ReactNode, type RefObject } from 'react';
import { t } from '../../i18n';
import type { CastMember, World } from '../../model/types';
import { patchSession, setTwist } from '../../state/session';
import { useStore } from '../../state/store';
import { Button, Footprints, IconButton } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import type { Box } from '../../world/objects';
import { SteerToastHost } from '../ai/SteerToast';
import { ChangeLayer } from './ChangeLayer';
import { NewVersionCard } from './NewVersionCard';
import { ProblemCard, problemToShow } from './ProblemCard';
import { CoachMark, RequestTag } from './RequestTag';

/** Twists that put many more things on screen: the first one on is what "Running slowly" offers to turn off. */
export const HEAVY_TWISTS: readonly string[] = ['enemyParty', 'starRain', 'surpriseBoss', 'earthquake'];

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
    <div className="world-view__stopped world-card" role="alert" data-testid="world-stopped">
      <p className="world-view__stopped-title">{t('world.stoppedTitle')}</p>
      <Button variant="lantern" icon="restart" size={38} onClick={onRestart}>
        {t('world.restartIt')}
      </Button>
    </div>
  );
}

/** "Games can't open web pages or use the internet, so Amble restarted it." until closed. */
function Navigated() {
  const stopped = useStore((s) => s.session.stopped);
  if (stopped !== 'navigated') return null;
  return (
    <div className="world-view__notice world-card" role="status" data-testid="world-navigated">
      <Icon name="info" size={20} className="world-view__notice-icon" />
      <p className="world-view__notice-text">{t('world.navigated')}</p>
      <IconButton icon="close" label={t('common.dismiss')} size={38} variant="quiet" tooltip={false} onClick={() => patchSession({ stopped: null })} />
    </div>
  );
}

/**
 * "Running slowly." after 10 s under 20 fps (§2.6): something to do about it (close other tabs, and turn
 * off the twist that crowds the screen, or restart), at the bottom centre of the world view: no game keeps
 * its HUD there, and it stays clear of the touch stick and buttons in the bottom corners. It waits while
 * another card down there has the student's attention, and goes once closed.
 */
function Heavy({ onRestart }: { onRestart(): void }) {
  const heavy = useStore((s) => s.session.heavy);
  const busy = useStore((s) => s.session.mode !== 'play' || !!s.session.request || !!s.session.newVersion?.ready || !!problemToShow(s.session.problems) || s.session.stopped !== null);
  const twist = useStore((s) => (s.session.manifest?.twists ?? []).find((x) => x.on && HEAVY_TWISTS.includes(x.id)) ?? null);
  const [closed, setClosed] = useState(false);
  if (!heavy || closed || busy) return null;
  return (
    <div className="world-view__heavy world-card" role="status" data-testid="world-heavy">
      <Icon name="info" size={20} className="world-view__heavy-icon" />
      <p className="world-view__heavy-text">
        <strong>{t('world.heavyTitle')}</strong> {twist ? t('world.heavyTwist', { name: twist.name }) : t('world.heavyPlain')}
      </p>
      {twist ? (
        <Button
          variant="paper"
          size={38}
          onClick={() => {
            setTwist(twist.id, false);
            setClosed(true);
          }}
        >
          {t('world.heavyTurnOff', { name: twist.name })}
        </Button>
      ) : (
        <Button
          variant="paper"
          icon="restart"
          size={38}
          onClick={() => {
            setClosed(true);
            onRestart();
          }}
        >
          {t('world.restart')}
        </Button>
      )}
      <IconButton icon="close" label={t('common.dismiss')} size={38} variant="quiet" tooltip={false} onClick={() => setClosed(true)} />
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

  return (
    <div ref={ref} className={cx('world-view', mode === 'change' && 'world-view--change')} data-testid="world-view">
      <div ref={slotRef} id="game" className="world-view__slot" role="region" tabIndex={-1} aria-label={t('world.worldRegion', { title: world.title })} data-testid="world-slot" />
      <Loading title={world.title} />
      <Navigated />
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
      {/* Mounted in both modes, so closing it holds until the world is opened again. */}
      <Heavy onRestart={onRestart} />
      {mode === 'change' && frame && <ChangeLayer frame={frame} onDraw={(m) => onDraw(m)} onBones={onBones} />}
      {/* Above Change mode's veil, so a broken or stopped world can be fixed from either mode. */}
      <ProblemCard world={world} onRestart={onRestart} />
      <Stopped onRestart={onReload} />
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
