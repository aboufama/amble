/**
 * The First page's right column (§2.3). Before the doodle is alive: **"Or play one first."** with four
 * starter cards. After Bring it to life: **"Now give {name} a world."** with four world cards showing the
 * creature inside each world and **More worlds ▸**. The idea box follows the cards when wishes are
 * available. A class assignment puts its note above the cards, and its world type comes first, marked.
 */
import type { CSSProperties } from 'react';
import { Link } from '../../app/Link';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import type { PlanHero } from '../../home/planSession';
import { FIRST_SEEDS } from '../../home/seedThumbs';
import type { PoseImage } from '../../home/seedThumbs';
import type { ArtId, Assignment, StarterId } from '../../model/types';
import { setLegacy } from '../../state/library';
import { useStore } from '../../state/store';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { LegacyCard } from '../files/LegacyCard';
import { IdeaBox } from '../newworld/IdeaBox';
import { SeedCard } from '../newworld/SeedCard';

export interface FirstColumnProps {
  alive: { id: ArtId; name: string; pose: PoseImage | null; hero: PlanHero } | null;
  assignment: Assignment | null;
  busySeed: StarterId | null;
  onSeed(seed: StarterId): void;
  onStarter(id: StarterId): void;
  firstCard?: (el: HTMLButtonElement | null) => void;
}

/** The world types, the assignment's first when a class link carries one. */
export function firstSeeds(assignment: Assignment | null): StarterId[] {
  const seeds = [...FIRST_SEEDS];
  const asg = assignment?.starter;
  if (!asg) return seeds;
  return [asg, ...seeds.filter((s) => s !== asg)].slice(0, 4);
}

export function FirstColumn({ alive, assignment, busySeed, onSeed, onStarter, firstCard }: FirstColumnProps) {
  const { starters } = useServices();
  const legacy = useStore((s) => s.library.legacy);
  const starterList = starters.list().slice(0, 4);

  return (
    <div className={cx('first-col', alive && 'first-col--alive')} data-testid="first-column">
      {legacy && <LegacyCard legacy={legacy} onDone={() => setLegacy(null)} />}
      {assignment && !alive && (
        <div className="teacher-note" role="note">
          <p className="teacher-note__from">{t('home.fromTeacher')}</p>
          <p className="teacher-note__title">{assignment.title}</p>
          <p className="teacher-note__text">{t('home.teacherDrawFirst')}</p>
        </div>
      )}
      {alive ? (
        <>
          <h2 className="first-col__title first-col__title--give">
            {t('home.giveWorldTitle', { name: '\u0000' })
              .split('\u0000')
              .flatMap((part, i) => (i === 0 ? [part] : [<span key="n" className="first-col__name">{alive.name}</span>, part]))}
          </h2>
          <p className="first-col__lede">{t('home.giveWorldLede', { name: alive.name })}</p>
          <div className="first-col__cards" role="list">
            {firstSeeds(assignment).map((seed, i) => (
              <div role="listitem" key={seed} className="first-col__card" style={{ ['--i' as string]: i } as CSSProperties}>
                <SeedCard
                  seed={seed}
                  info={starters.info(seed)}
                  kind="seed"
                  pose={alive.pose}
                  heroName={alive.name}
                  checked={Boolean(assignment?.starter && seed === assignment.starter)}
                  ribbon={assignment?.starter === seed ? t('home.fromTeacher') : null}
                  busy={busySeed === seed}
                  disabled={busySeed !== null && busySeed !== seed}
                  onPick={() => onSeed(seed)}
                  cardRef={i === 0 ? firstCard : undefined}
                />
              </div>
            ))}
          </div>
          <Link to={{ name: 'new', hero: alive.id, idea: false }} className="btn btn--quiet btn--h38 first-col__more" data-testid="more-worlds">
            <span className="btn__label">{t('home.moreWorlds')}</span>
            <Icon name="back" size={18} className="icon--flip" />
          </Link>
        </>
      ) : (
        <>
          <h2 className="first-col__title">{t('home.playFirstTitle')}</h2>
          <p className="first-col__lede">{t('home.playFirstLede')}</p>
          <div className="first-col__cards" role="list">
            {starterList.map((info) => (
              <div role="listitem" key={info.id} className="first-col__card">
                <SeedCard seed={info.id as StarterId} info={info} kind="starter" onPick={() => onStarter(info.id as StarterId)} />
              </div>
            ))}
          </div>
        </>
      )}
      <IdeaBox variant="first" hero={alive?.hero ?? null} className="first-col__idea" />
    </div>
  );
}
