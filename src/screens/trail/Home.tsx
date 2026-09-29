/**
 * `#/` Home (§2.1; M1 owns): the First page for a student with no worlds and no drawings, else the Trail.
 * FOUNDATION-STUB: shows which one it would pick.
 */
import { useEffect } from 'react';
import { ScreenStub } from '../../app/frame/ScreenStub';
import { useServices } from '../../app/services';
import { refreshLibrary } from '../../state/library';
import { useStore } from '../../state/store';

export function Home() {
  const { store } = useServices();
  const loaded = useStore((s) => s.library.loaded);
  const empty = useStore((s) => s.library.worlds.length === 0 && s.library.characters.length === 0 && !s.prefs.seen.firstPage);
  useEffect(() => {
    void refreshLibrary(store);
  }, [store]);
  return (
    <div className="screen-wrap" data-testid="screen-home" data-home={!loaded ? 'loading' : empty ? 'first' : 'trail'}>
      <ScreenStub route={{ name: 'home' }} name={!loaded || !empty ? 'trail-home' : 'first-home'} />
    </div>
  );
}
