/**
 * `#/new` the New world sheet (§2.5): a bottom sheet over the Trail. **"Give {name} a world."** (or
 * **"Pick a world"** with no hero), five world types with the student's character standing in each
 * scene, and, with the AI helper on, **"Or describe your own world…"** with **Imagine it ✦**. **Start**
 * makes the world from the picked seed (the hero drawn, everything else just bones) and opens it; **Not
 * now** leaves the character on the Trail. `?hero=` names the character; `?idea=1` focuses the idea box.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { navigate } from '../../app/router';
import type { RouteOf } from '../../app/routes';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { openSeed } from '../../home/createWorld';
import { stopPlan, usePlanSession } from '../../home/planSession';
import { SHEET_SEEDS } from '../../home/seedThumbs';
import { useHero } from '../../home/useHero';
import type { StarterId } from '../../model/types';
import { showToast } from '../../state/app';
import { useStore } from '../../state/store';
import { rovingIndex } from '../../ui/a11y';
import { Button, Sheet } from '../../ui/components';
import { Trail } from '../trail/Trail';
import { IdeaBox } from './IdeaBox';
import { PlanWaiting } from './PlanWaiting';
import { SeedCard } from './SeedCard';
import './newworld.css';

export function NewWorldSheet({ route }: { route: RouteOf<'new'> }) {
  const { starters } = useServices();
  const hero = useHero(route.hero);
  const asg = useStore((s) => s.config.classLink?.asg ?? null);
  const session = usePlanSession();
  const [picked, setPicked] = useState<StarterId | null>(asg?.starter ?? null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const cards = useRef<Array<HTMLButtonElement | null>>([]);
  const name = hero.record?.name ?? null;

  const seeds: StarterId[] = asg?.starter ? [asg.starter, ...SHEET_SEEDS.filter((s) => s !== asg.starter)] : [...SHEET_SEEDS];

  // The plan arrives while the sheet waits: the plan card takes over.
  useEffect(() => {
    if (waiting && session.status === 'done') navigate({ name: 'plan' });
  }, [waiting, session.status]);

  const close = () => {
    if (waiting) stopPlan();
    navigate({ name: 'trail', view: 'trail' });
  };

  const start = async () => {
    if (!picked || busy) return;
    setBusy(true);
    try {
      const world = await openSeed(picked, route.hero && hero.record ? route.hero : null);
      navigate({ name: 'world', id: world.id });
    } catch (err) {
      console.warn('The world could not open:', err);
      showToast(t('home.couldNotSave'), { kind: 'error' });
      setBusy(false);
    }
  };

  const onCardKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = rovingIndex(e.key, i, seeds.length, 'both');
    if (next === null) return;
    e.preventDefault();
    setPicked(seeds[next]);
    cards.current[next]?.focus();
  };

  const focusIndex = Math.max(0, picked ? seeds.indexOf(picked) : 0);
  const heroForPlan = hero.record ? { id: hero.record.id, name: hero.record.name, kind: hero.record.kind, rig: hero.record.rig } : null;

  return (
    <div className="new-world" data-testid="screen-new">
      <div className="new-world__behind" inert>
        <Trail route={{ name: 'trail', view: 'trail' }} />
      </div>
      <Sheet
        open
        onClose={close}
        title={name ? t('home.sheetTitleHero', { name }) : t('home.sheetTitle')}
        className="new-world__sheet"
        actions={
          waiting ? undefined : (
            <>
              <Button variant="quiet" onClick={close} data-testid="not-now">
                {t('home.notNow')}
              </Button>
              <Button variant="lantern" icon="play" disabled={!picked} busy={busy} onClick={() => void start()} data-testid="seed-start">
                {t('home.start')}
              </Button>
            </>
          )
        }
      >
        {waiting && session.status === 'waiting' ? (
          <PlanWaiting
            idea={session.idea}
            onStop={() => {
              stopPlan();
              setWaiting(false);
            }}
          />
        ) : (
          <>
            <p className="new-world__lede">{t('home.sheetLede')}</p>
            <div className="new-world__cards" role="radiogroup" aria-label={t('home.seedsLabel')}>
              {seeds.map((seed, i) => (
                <SeedCard
                  key={seed}
                  seed={seed}
                  info={starters.info(seed)}
                  kind="seed"
                  pose={hero.pose}
                  heroName={name}
                  radio
                  checked={picked === seed}
                  tabIndex={i === focusIndex ? 0 : -1}
                  ribbon={asg?.starter === seed ? t('home.fromTeacher') : null}
                  onPick={() => setPicked(seed)}
                  onKeyDown={(e) => onCardKey(e, i)}
                  cardRef={(el) => {
                    cards.current[i] = el;
                  }}
                  className="new-world__card"
                />
              ))}
            </div>
            <IdeaBox variant="sheet" hero={heroForPlan} autoFocus={route.idea} onPlanning={() => setWaiting(true)} hideWhenOff className="new-world__idea" />
          </>
        )}
      </Sheet>
    </div>
  );
}
