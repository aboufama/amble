/**
 * `#/w/<id>/draw/<key>` and `#/draw/<artId|new>`: the Desk (§2.10; M3). Opens the drawing (its saved
 * thumbnail first while the layers come in), then the workspace. A drawing that is not there goes back to
 * the Trail; a world that is too big for a new drawing goes back to the world.
 */
import { useEffect, useState } from 'react';
import { navigate } from '../../app/router';
import type { RouteOf } from '../../app/routes';
import { useServices } from '../../app/services';
import { loadFreeDesk, loadRequestDesk, newFreeId, type DeskSetup } from '../../draw/load';
import { t } from '../../i18n';
import { showToast } from '../../state/app';
import { setDraw } from '../../state/draw';
import { getState } from '../../state/store';
import { Footprints } from '../../ui/components';
import { DeskWorkspace } from './DeskWorkspace';
import { savesSettled } from './useDeskSaving';
import './desk.css';

export function Desk({ route }: { route: RouteOf<'draw'> | RouteOf<'drawFree'> }) {
  const { store } = useServices();
  const [setup, setSetup] = useState<DeskSetup | null>(null);

  useEffect(() => {
    let live = true;
    if (route.name === 'drawFree' && route.artId === 'new') {
      navigate({ name: 'drawFree', artId: newFreeId() }, { replace: true, transition: false });
      return;
    }
    const session = getState().session;
    // A drawing saved as the last Desk closed is committed before it is opened again.
    const load = savesSettled().then(() =>
      route.name === 'draw'
        ? loadRequestDesk(store, route.worldId, route.key, session.world?.id === route.worldId ? session.cast : [])
        : loadFreeDesk(store, route.artId),
    );
    void load.then(
      (r) => {
        if (!live) return;
        if (r.ok) {
          setDraw({ artId: r.setup.artId, mode: r.setup.mode, dirty: false });
          setSetup(r.setup);
          return;
        }
        if (r.reason === 'tooBig' && r.worldId) {
          showToast(t('files.worldTooBig'), { kind: 'error' });
          navigate({ name: 'world', id: r.worldId }, { replace: true });
        } else {
          showToast(t('draw.notFound'));
          navigate({ name: 'trail', view: 'trail' }, { replace: true });
        }
      },
      (err: unknown) => {
        console.error('The Desk could not open:', err);
        if (!live) return;
        showToast(t('draw.notFound'), { kind: 'error' });
        navigate({ name: 'trail', view: 'trail' }, { replace: true });
      },
    );
    return () => {
      live = false;
      setDraw({ artId: null, mode: null, dirty: false });
    };
  }, [store, route]);

  if (!setup)
    return (
      <div className="screen desk desk--loading" data-testid="screen-draw">
        <main id="main" tabIndex={-1} className="desk__loading" aria-busy="true">
          <h1 className="sr-only">{t('draw.loading')}</h1>
          <div className="desk__loading-sheet" aria-hidden="true" />
          <Footprints />
          <p className="desk__loading-text">{t('draw.loading')}</p>
        </main>
      </div>
    );
  return <DeskWorkspace key={setup.artId} setup={setup} />;
}
