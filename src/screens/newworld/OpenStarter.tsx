/**
 * `#/starter/<id>` (§2.1; M1 routing, M8 content): opens a starter world as the student's own copy (with
 * its example drawings) and goes to it, replacing this route in history. The copy is kept only once the
 * student changes something; left unchanged, it is discarded when they leave it.
 */
import { useEffect } from 'react';
import { navigate } from '../../app/router';
import type { RouteOf } from '../../app/routes';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { watchStarterCopy } from '../../home/starterCopies';
import { showToast } from '../../state/app';
import { refreshLibrary } from '../../state/library';
import { Footprints } from '../../ui/components';
import './newworld.css';

/** Starter copies made in this page's life, by starter (StrictMode runs the effect twice in dev). */
const opening = new Map<string, Promise<string>>();

export function OpenStarter({ route }: { route: RouteOf<'starter'> }) {
  const { starters, store } = useServices();
  useEffect(() => {
    let live = true;
    let job = opening.get(route.id);
    if (!job) {
      job = (async () => {
        const { world, art, blobs } = await starters.open(route.id, { withArt: true });
        await store.commit({ blobs, art, worlds: [world] });
        watchStarterCopy(world.id);
        void refreshLibrary(store);
        return world.id;
      })();
      opening.set(route.id, job);
      void job.finally(() => window.setTimeout(() => opening.delete(route.id), 1000)).catch(() => undefined);
    }
    job.then(
      (id) => {
        if (live) navigate({ name: 'world', id }, { replace: true, transition: false });
      },
      (err: unknown) => {
        console.warn('The starter world could not open:', err);
        if (!live) return;
        showToast(t('home.couldNotSave'), { kind: 'error' });
        navigate({ name: 'trail', view: 'trail' }, { replace: true, transition: false });
      },
    );
    return () => {
      live = false;
    };
  }, [route.id, starters, store]);

  return (
    <div className="open-starter" data-testid="screen-starter">
      <main id="main" tabIndex={-1} className="open-starter__main">
        <Footprints label={t('home.opening')} />
        <h1 className="open-starter__title">{starters.info(route.id).title}</h1>
      </main>
    </div>
  );
}
