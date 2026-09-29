/**
 * `#/w/<id>/bones/<key>` and `#/bones/<artId>`: Bones (§2.11, §7.11; M4). The drawing with its
 * constellation of bones: drag or nudge any star, What is it?, Magic bones, Mirror sides, Add a wiggly
 * bit, Show pieces, and the live Watch {name} move preview with the Moves and their Feel. ✓ Done
 * returns to where the student came from; the bones save as they change, so leaving never asks.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AiChip } from '../../app/frame/AiChip';
import { Link } from '../../app/Link';
import type { Route, RouteOf } from '../../app/routes';
import { useCommand } from '../../app/keys';
import { useServices } from '../../app/services';
import { BonesController, type BonesTarget, type BonesView } from '../../bones/bonesController';
import { goBackTo, leaveBones } from '../../bones/leave';
import { facingWord } from '../../bones/kindWords';
import { t } from '../../i18n';
import type { CharacterKind } from '../../cores/rig';
import { announce, showToast } from '../../state/app';
import { Button, IconButton, Toggle } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { playUiSound } from '../../ui/sounds';
import { Constellation } from './Constellation';
import { KindPicker } from './KindPicker';
import { MovesPanel } from './MovesPanel';
import './bones.css';

type BonesRoute = RouteOf<'bones'> | RouteOf<'bonesFree'>;

function targetOf(route: BonesRoute): BonesTarget {
  return route.name === 'bones' ? { worldId: route.worldId, key: route.key } : { artId: route.artId };
}

export function Bones({ route }: { route: BonesRoute }) {
  const services = useServices();
  const target = useMemo(() => targetOf(route), [route]);
  const key = JSON.stringify(target);
  const [ctl, setCtl] = useState<BonesController | null>(null);

  useEffect(() => {
    const c = new BonesController(JSON.parse(key) as BonesTarget, services);
    setCtl(c);
    void c.open();
    return () => c.dispose();
  }, [key, services]);

  return ctl ? <BonesScreen ctl={ctl} route={route} /> : <BonesFrame route={route} view={null} />;
}

/** Where ◂ Drawing goes: the Desk for this drawing. */
function drawingRoute(route: BonesRoute): Route {
  return route.name === 'bones' ? { name: 'draw', worldId: route.worldId, key: route.key } : { name: 'drawFree', artId: route.artId };
}

function statusOf(v: BonesView): string {
  if (v.phase === 'loading') return t('bones.loading');
  if (v.busy === 'asking') return t('bones.statusAsking');
  if (v.busy) return t('bones.statusFinding');
  if (v.failed) return t('bones.statusFailed');
  if (v.needsKind) return t('bones.statusPick');
  const step = v.step;
  if (!step) return '';
  if (step.made === 'hand') return t('bones.statusHand');
  if (step.made === 'ai') return t('bones.statusAi');
  const n = step.rig.bones.length;
  return n === 1 ? t('bones.statusFoundOne') : t('bones.statusFound', { n });
}

interface FrameProps {
  route: BonesRoute;
  view: BonesView | null;
  status?: string;
  actions?: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
  onBack?: () => void;
}

/** The screen's landmarks and top bar: ◂ Drawing · {name}'s bones + status · Undo · Redo · ✓ Done. */
function BonesFrame({ route, view, status, actions, children, aside, onBack }: FrameProps) {
  const name = view?.name ?? '';
  return (
    <div className={aside ? 'screen bones-screen' : 'screen bones-screen bones-screen--solo'} data-testid="screen-bones">
      <header className="topbar bones-top">
        <div className="topbar__start bones-top__start">
          <Link
            to={drawingRoute(route)}
            className="btn btn--ghost btn--h44 topbar__back"
            onClick={(e) => {
              e.preventDefault();
              onBack?.();
              goBackTo(drawingRoute(route));
            }}
          >
            <Icon name="back" size={20} />
            <span className="btn__label">{t('bones.back')}</span>
          </Link>
          <h1 className="topbar__title bones-top__title">{name ? t('bones.title', { name }) : t('common.routeBones')}</h1>
          {status && (
            <p className="bones-top__status" data-testid="bones-status">
              {status}
            </p>
          )}
        </div>
        <div className="topbar__end bones-top__end">
          <AiChip />
          {actions}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="bones-main">
        {children}
      </main>
      {aside}
    </div>
  );
}

function BonesScreen({ ctl, route }: { ctl: BonesController; route: BonesRoute }) {
  const view = useSyncExternalStore(ctl.subscribe, ctl.getView);
  const [wiggly, setWiggly] = useState(false);
  const [pieces, setPieces] = useState(false);
  const [kindOpen, setKindOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const rig = view.rig;
  const busy = !!view.busy;

  // no bones yet: "What is it?" opens by itself (the empty and failed states)
  useEffect(() => {
    if (view.needsKind && !view.busy) setKindOpen(true);
  }, [view.needsKind, view.busy]);

  useEffect(() => {
    if (view.busy) announce(view.busy === 'asking' ? t('bones.statusAsking') : t('bones.statusFinding'));
  }, [view.busy]);

  useCommand('undo', () => {
    if (!view.canUndo) return false;
    ctl.undo();
    return true;
  });
  useCommand('redo', () => {
    if (!view.canRedo) return false;
    ctl.redo();
    return true;
  });

  const from = { worldId: view.worldId, castKey: view.castKey, artId: view.artId };

  const done = async () => {
    if (leaving) return;
    setLeaving(true);
    playUiSound('put');
    try {
      await ctl.finish();
    } finally {
      leaveBones(from);
    }
  };

  const status = statusOf(view);
  const ready = view.phase === 'ready';
  const kind: CharacterKind = rig?.kind ?? (ctl.art?.rig && ctl.art.rig !== 'none' ? ctl.art.rig : 'biped');
  const facing = rig ? facingWord(rig.facing) : ctl.art?.facing ?? 'viewer';

  const actions = (
    <>
      <Button variant="ghost" icon="undo" disabled={!view.canUndo || busy} onClick={() => ctl.undo()}>
        {t('bones.undo')}
      </Button>
      <IconButton icon="redo" variant="ghost" label={t('bones.redo')} disabled={!view.canRedo || busy} onClick={() => ctl.redo()} />
      <Button variant="lantern" icon="check" className="bones-done" busy={leaving} onClick={() => void done()} disabled={view.phase === 'loading'}>
        {t('bones.done')}
      </Button>
    </>
  );

  if (!ready) {
    return (
      <BonesFrame route={route} view={view} status={view.phase === 'loading' ? status : undefined} actions={actions}>
        <div className="bones-sky bones-sky--empty">
          <EmptyState view={view} route={route} />
        </div>
      </BonesFrame>
    );
  }

  return (
    <BonesFrame
      route={route}
      view={view}
      status={status}
      actions={actions}
      onBack={() => void ctl.finish()}
      aside={<MovesPanel ctl={ctl} view={view} route={route} />}
    >
      <div className="bones-tools" role="toolbar" aria-label={t('bones.toolbar')}>
        <KindPicker
          value={kind}
          facing={facing}
          unset={!rig && !ctl.art?.rigData && ctl.art?.rig === 'none'}
          open={kindOpen}
          onOpenChange={setKindOpen}
          disabled={busy}
          onChange={(k, f) => void ctl.setKindFacing(k, f)}
          className="bones-tools__kind"
        />
        <Button variant="ghost" icon="sparkle" disabled={busy} onClick={() => void ctl.magic()}>
          {t('bones.magic')}
        </Button>
        <Button
          variant="ghost"
          icon="mirror"
          disabled={busy || !rig}
          onClick={() => {
            const ok = ctl.mirror();
            const text = ok ? t('bones.mirrored') : t('bones.mirrorNothing');
            if (ok) announce(text);
            else showToast(text);
          }}
        >
          {t('bones.mirror')}
        </Button>
        <Button variant="ghost" icon="plus" aria-pressed={wiggly} disabled={busy || !rig} onClick={() => setWiggly((w) => !w)}>
          {t('bones.wiggly')}
        </Button>
        <Toggle className="bones-tools__pieces" label={t('bones.pieces')} checked={pieces} onChange={setPieces} disabled={!view.bound} />
      </div>
      <Constellation ctl={ctl} view={view} wiggly={wiggly} onWigglyDone={() => setWiggly(false)} pieces={pieces} />
    </BonesFrame>
  );
}

function EmptyState({ view, route }: { view: BonesView; route: BonesRoute }) {
  if (view.phase === 'loading') {
    return <div className="bones-empty bones-empty--loading" aria-hidden="true" />;
  }
  if (view.phase === 'undrawn') {
    const name = view.name;
    return (
      <div className="bones-empty">
        <svg className="bones-empty__stars" viewBox="0 0 120 150" aria-hidden="true" focusable="false">
          <path d="M60 22 V70 M60 36 L38 58 L30 84 M60 36 L82 58 L90 84 M60 70 L46 104 L42 132 M60 70 L74 104 L78 132" />
          {[
            [60, 22], [60, 36], [60, 70], [38, 58], [30, 84], [82, 58], [90, 84], [46, 104], [42, 132], [74, 104], [78, 132],
          ].map(([x, y]) => (
            <circle key={`${x},${y}`} cx={x} cy={y} r={4.2} />
          ))}
        </svg>
        <h2 className="bones-empty__title">{t('bones.undrawnTitle', { name })}</h2>
        <p className="bones-empty__body">{t('bones.undrawnBody', { name })}</p>
        <Link to={drawingRoute(route)} className="btn btn--lantern btn--h44">
          <Icon name="draw" size={20} />
          <span className="btn__label">{t('bones.undrawnDraw', { name })}</span>
        </Link>
      </div>
    );
  }
  return (
    <div className="bones-empty">
      <h2 className="bones-empty__title">{t('bones.missingTitle')}</h2>
      <p className="bones-empty__body">{t('bones.missingBody')}</p>
      <Link to={{ name: 'trail', view: 'trail' }} className="btn btn--ghost btn--h44">
        <Icon name="trail" size={20} />
        <span className="btn__label">{t('bones.missingBack')}</span>
      </Link>
    </div>
  );
}
