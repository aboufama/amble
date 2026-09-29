/**
 * `#/w/<id>/code[/<file>]` Look inside (§2.12): the real code of the world beside the still-running game
 * (520x293, top right). File tabs, CodeMirror with the validator's kid-readable diagnostics, the provenance
 * gutter, art-key chips, kit docs, teacher locks, **▶ Run it** (Ctrl+Enter), **Undo my edits** and
 * **Explain this**. CodeMirror loads as its own chunk after the frame and the game are in place.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useCommand } from '../../app/keys';
import { ScreenFrame } from '../../app/frame/ScreenFrame';
import { TopBar } from '../../app/frame/TopBar';
import { usePlayerSlot } from '../../app/player/slots';
import { navigate } from '../../app/router';
import type { RouteOf } from '../../app/routes';
import { useServices } from '../../app/services';
import { playWorld } from '../../history/live';
import { t } from '../../i18n';
import { openWorld } from '../../state/session';
import { getState, subscribe, useStore } from '../../state/store';
import { Button, Footprints } from '../../ui/components';
import { Lamppost } from '../../ui/icons';
import { CrisisCard } from '../ai/CrisisCard';
import { FileTabs, tabId } from './FileTabs';
import { HelpPanel } from './HelpPanel';
import { onLookInside, takeLookInside } from './open';
import { RunBar } from './RunBar';
import type { CodeSession, CodeSnapshot } from './session';
import './code.css';

type Phase = 'opening' | 'ready' | 'missing';

const PANEL_ID = 'code-editor';
const noSubscribe = () => () => undefined;
const noSnapshot = (): CodeSnapshot | null => null;

/**
 * Opens the world into the session (unless it already is) and snapshots its first step. The code shows
 * at once; the game starts beside it when this screen opened the world (coming from the world screen, the
 * game is already running there and keeps running here).
 */
function useOpenWorld(worldId: string): Phase {
  const { history } = useServices();
  const [phase, setPhase] = useState<Phase>('opening');
  useEffect(() => {
    let live = true;
    setPhase('opening');
    void (async () => {
      const open = getState().session.world;
      let world = open?.id === worldId ? open : null;
      const openedHere = !world;
      if (!world) {
        world = await openWorld(worldId);
        if (!live) return;
        if (!world) {
          setPhase('missing');
          return;
        }
      }
      setPhase('ready');
      void history.ensureHead(world).catch(() => undefined);
      if (openedHere) void playWorld(world).catch(() => undefined);
    })();
    return () => {
      live = false;
    };
  }, [worldId, history]);
  return phase;
}

function WorldSlot({ title }: { title: string }) {
  const slot = useRef<HTMLDivElement>(null);
  usePlayerSlot('code', slot);
  return (
    <div className="code-world" ref={slot} data-testid="code-world-slot">
      <div className="code-world__idle" aria-hidden="true">
        <Lamppost height={44} />
        <span className="code-world__title">{title}</span>
      </div>
    </div>
  );
}

export function CodeView({ route }: { route: RouteOf<'code'> }) {
  const services = useServices();
  const phase = useOpenWorld(route.worldId);
  const world = useStore((s) => (s.session.world?.id === route.worldId ? s.session.world : null));
  const building = useStore((s) => s.ai.job?.worldId === route.worldId && s.ai.job.task === 'build');
  const [session, setSession] = useState<CodeSession | null>(null);
  const [crisis, setCrisis] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const snap = useSyncExternalStore(session?.subscribe ?? noSubscribe, session?.getSnapshot ?? noSnapshot);
  const hasCode = !!world && world.code.length > 0 && !building;
  const worldId = route.worldId;

  const openDesk = useCallback((key: string) => navigate({ name: 'draw', worldId, key }), [worldId]);
  // The file in the address when the editor opens (later changes go through session.open).
  const firstFile = useRef(route.file);

  // The editor session, once the world is open (CodeMirror arrives as a lazy chunk).
  useEffect(() => {
    if (phase !== 'ready' || !hasCode) return;
    let live = true;
    let created: CodeSession | null = null;
    void import('./session').then(({ CodeSession }) => {
      const current = getState().session.world;
      if (!live || !current || current.id !== worldId) return;
      created = new CodeSession({
        services,
        world: current,
        file: firstFile.current,
        onDraw: openDesk,
        onFileChange: (file) => navigate({ name: 'code', worldId, file }, { replace: true, transition: false }),
        onCrisis: () => setCrisis(true),
      });
      setSession(created);
    });
    return () => {
      live = false;
      created?.destroy();
      setSession(null);
    };
  }, [phase, hasCode, worldId, services, openDesk]);

  useLayoutEffect(() => {
    if (session && host.current) session.mount(host.current);
  }, [session]);

  useEffect(() => {
    if (session && route.file) session.open(route.file);
  }, [session, route.file]);

  // A place asked for from elsewhere ("Show me the line", an explanation for an explain-only class).
  useEffect(() => {
    if (!session) return;
    const waiting = takeLookInside(worldId);
    if (waiting) session.show(waiting);
    return onLookInside((request) => {
      if (request.worldId !== worldId) return;
      takeLookInside(worldId);
      session.show(request);
    });
  }, [session, worldId]);

  // A newer version of the world (an AI change, Go back, our own Run it) flows into the editors.
  useEffect(
    () =>
      subscribe((state, prev) => {
        const w = state.session.world;
        if (session && w && w.id === worldId && w !== prev.session.world) session.adopt(w);
      }),
    [session, worldId],
  );

  useCommand('submit', () => {
    if (!session) return false;
    void session.runIt();
  });

  const activeDirty = !!snap?.files.find((f) => f.path === snap.active)?.dirty;
  const title = world?.title ?? t('common.routeWorld');
  const header = <TopBar back={{ to: { name: 'world', id: worldId }, label: title }} title={t('common.routeCode')} />;

  if (phase === 'missing') {
    return (
      <ScreenFrame testId="screen-code" header={<TopBar title={t('common.routeCode')} />} className="code-screen code-screen--empty">
        <div className="code-empty">
          <Lamppost height={56} />
          <h2 className="code-empty__title">{t('history.worldMissing')}</h2>
          <Button variant="lantern" onClick={() => navigate({ name: 'trail', view: 'trail' })}>
            {t('history.backToTrail')}
          </Button>
        </div>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame
      testId="screen-code"
      header={header}
      className="code-screen"
      asideLabel={t('history.helpLabel')}
      aside={
        <>
          <WorldSlot title={title} />
          {snap && (
            <HelpPanel
              issues={snap.issues}
              multiFile={snap.files.length > 1}
              cursor={snap.cursor}
              onJump={(issue) => session?.jumpTo(issue.file, issue.line)}
              onFix={(issue) => session?.fix(issue)}
              onDraw={openDesk}
            />
          )}
        </>
      }
    >
      <section className="code-main" aria-labelledby="code-header">
        {phase === 'ready' && world && !hasCode ? (
          <div className="code-empty code-empty--inline">
            <Footprints label={t('history.noCodeTitle')} />
            <h2 id="code-header" className="code-empty__title">
              {t('history.noCodeTitle')}
            </h2>
            <p className="code-empty__body">{t('history.noCodeBody')}</p>
          </div>
        ) : (
          <>
            <p id="code-header" className="code-main__header">
              {t('history.codeHeader')}
            </p>
            <div className="code-main__bar">
              {snap && <FileTabs files={snap.files} active={snap.active} panelId={PANEL_ID} onOpen={(p) => session?.open(p)} />}
              <div className="code-main__actions">
                <Button variant="quiet" size={38} icon="undo" disabled={!activeDirty} onClick={() => session?.undoEdits()}>
                  {t('history.undoEdits')}
                </Button>
                <Button variant="ai" size={38} icon="sparkle" disabled={!session || snap?.explaining} title={t('history.explainHint')} onClick={() => void session?.explain()}>
                  {t('history.explain')}
                </Button>
                <Button
                  variant="lantern"
                  size={44}
                  icon="play"
                  disabled={!session}
                  busy={snap?.run.kind === 'starting'}
                  aria-keyshortcuts="Control+Enter"
                  data-testid="run-it"
                  onClick={() => void session?.runIt()}
                >
                  {t('history.runIt')}
                </Button>
              </div>
            </div>
            <div className="code-main__editor" id={PANEL_ID} role="tabpanel" aria-labelledby={snap ? tabId(snap.active) : undefined} ref={host}>
              {!session && (
                <div className="code-main__loading">
                  <Footprints label={t('history.loadingEditor')} />
                  <span>{t('history.loadingEditor')}</span>
                </div>
              )}
            </div>
            {snap && session && (
              <RunBar
                run={snap.run}
                message={session.runMessage()}
                oldDraft={snap.oldDraft}
                onShow={() => {
                  const r = snap.run;
                  if (r.kind === 'blocked') session.jumpTo(r.file, r.line);
                  else if ((r.kind === 'runtime' || r.kind === 'failed') && r.file && r.line) session.jumpTo(r.file, r.line);
                }}
                onBringBack={() => session.bringBackDraft()}
              />
            )}
          </>
        )}
      </section>
      <CrisisCard open={crisis} onClose={() => setCrisis(false)} />
    </ScreenFrame>
  );
}
