/**
 * `#/` Home (§2.1): the First page for a student with no worlds and no drawings (and the First page
 * never finished), otherwise the Trail (or its List view, when that was the last choice). It never shows
 * a spinner: while the library loads, the night sky is already there.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { starterCopiesPending, starterCopiesSettled } from '../../home/starterCopies';
import { homeChoice, type HomeChoice } from '../../home/trailData';
import { refreshLibrary } from '../../state/library';
import { useStore } from '../../state/store';
import { NightSky } from './Landscape';
import { Trail } from './Trail';

const FirstPage = lazy(async () => ({ default: (await import('../first')).FirstPage }));

export function Home() {
  const { store } = useServices();
  const loaded = useStore((s) => s.library.loaded);
  const worlds = useStore((s) => s.library.worlds);
  const characters = useStore((s) => s.library.characters);
  const seen = useStore((s) => s.prefs.seen);
  const view = useStore((s) => s.prefs.trailView);
  // A starter the student just played untouched is on its way out: choose once it is gone, so leaving it
  // does not turn a first visit into the Trail.
  const [copiesSettled, setCopiesSettled] = useState(() => !starterCopiesPending());
  useEffect(() => {
    if (copiesSettled) return;
    let live = true;
    void starterCopiesSettled().then(() => live && setCopiesSettled(true));
    return () => {
      live = false;
    };
  }, [copiesSettled]);
  const live = copiesSettled ? homeChoice({ loaded, worlds, characters }, seen) : 'loading';
  // The choice holds for this visit: the First page must not turn into the Trail the moment its doodle
  // becomes the student's first drawing.
  const [latched, setLatched] = useState<HomeChoice | null>(null);
  const choice = latched ?? live;

  useEffect(() => {
    if (latched === null && live !== 'loading') setLatched(live);
  }, [latched, live]);

  useEffect(() => {
    void refreshLibrary(store);
  }, [store]);

  const sky = (
    <div className="home-wait">
      <NightSky />
    </div>
  );
  return (
    <div className="screen-wrap" data-testid="screen-home" data-home={choice}>
      {choice === 'loading' ? (
        sky
      ) : choice === 'first' ? (
        <Suspense fallback={sky}>
          <FirstPage />
        </Suspense>
      ) : (
        <Trail route={{ name: 'trail', view: view === 'list' ? 'list' : 'trail' }} />
      )}
    </div>
  );
}
