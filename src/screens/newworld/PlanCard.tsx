/**
 * `#/plan` the plan card (§2.5; spec-mocks/10-plan-card.png in the Scratch look): the student's idea as a
 * world plan. Title, pitch, how you play, **The twist**, **You draw these** (hero first, the rest as just
 * bones), **Amble will build** and the dials, with a quiet **How wishes work**. **✎ Draw {hero} while I
 * build** makes the world at once (its Warm-up plays the cast idling), starts the build in the background
 * and opens the Desk on the hero; **Build it first, draw later** opens the world. While the plan is on its
 * way it shows the waiting card; a plan that can't be made offers the closest starter (the ladder's first
 * rung).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from '../../app/Link';
import { navigate } from '../../app/router';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { createPlanWorld, firstToDraw, openSeed, planHeroKey, startBuild } from '../../home/createWorld';
import { clearPlanOutcome, getPlanSession, startPlan, stopPlan, usePlanSession, type PlanSessionState } from '../../home/planSession';
import type { PlanCastItem, PlanReply, StarterId } from '../../model/types';
import { showToast } from '../../state/app';
import { getState } from '../../state/store';
import { Button, Keycap, PlaceholderGlyph, Tag, Wordmark } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { AiExplainer } from '../ai/AiExplainer';
import { CrisisCard } from '../ai/CrisisCard';
import { RefusalCard } from '../ai/RefusalCard';
import '../trail/header.css';
import { PlanWaiting } from './PlanWaiting';
import './newworld.css';

/** Members listed one by one: characters, and anything the plan says is required. */
function isMain(c: PlanCastItem): boolean {
  return c.required || c.kind === 'character';
}

function shapeOf(c: PlanCastItem) {
  if (c.kind === 'item') return 'coin' as const;
  if (c.kind === 'terrain') return 'tile' as const;
  if (c.kind === 'projectile') return 'ellipse' as const;
  return 'capsule' as const;
}

function CastRow({ c, n, drawn }: { c: PlanCastItem; n: number; drawn: boolean }) {
  return (
    <li className={cx('plan-cast', n === 1 && 'plan-cast--first')}>
      <span className="plan-cast__num" aria-hidden="true">
        {n}
      </span>
      <span className="plan-cast__glyph">
        <PlaceholderGlyph rig={c.rig} role={c.role} shape={shapeOf(c)} size={58} name={c.name} />
      </span>
      <span className="plan-cast__text">
        <span className="plan-cast__name">{c.name}</span>
        <span className="plan-cast__about">{drawn ? t('home.alreadyDrawn') : c.about}</span>
      </span>
      <Tag role={c.role} variant="dark" className="plan-cast__role" />
    </li>
  );
}

/** "A bubble · ground · sky" for the optional pieces. */
function optionalLine(items: PlanCastItem[]): string {
  return items.map((c, i) => (i === 0 ? c.name : c.name.toLowerCase())).join(' · ');
}

function Plan({ plan, session, onReplan }: { plan: PlanReply; session: PlanSessionState; onReplan(text: string): void }) {
  const [busy, setBusy] = useState<'draw' | 'build' | null>(null);
  const [how, setHow] = useState(false);
  const [again, setAgain] = useState('');
  const heroId = session.hero?.id ?? null;
  const heroKey = planHeroKey(plan);
  const heroItem = plan.cast.find((c) => c.key === heroKey) ?? plan.cast[0];
  const toDraw = firstToDraw(plan, Boolean(heroId));
  const main = plan.cast.filter(isMain);
  const optional = plan.cast.filter((c) => !isMain(c));

  const go = async (mode: 'draw' | 'build') => {
    if (busy) return;
    setBusy(mode);
    try {
      const world = await createPlanWorld(plan, session.idea, heroId);
      startBuild(world, plan);
      clearPlanOutcome();
      showToast(t('home.buildStarted', { title: world.title }), { kind: 'info' });
      if (mode === 'draw' && toDraw) navigate({ name: 'draw', worldId: world.id, key: toDraw.key });
      else navigate({ name: 'world', id: world.id });
    } catch (err) {
      console.warn('The world could not be made:', err);
      showToast(t('home.couldNotSave'), { kind: 'error' });
      setBusy(null);
    }
  };

  const replan = (e: FormEvent) => {
    e.preventDefault();
    const words = again.replace(/\s+/g, ' ').trim();
    if (words) onReplan(`${session.idea} ${words}`.slice(0, 300));
  };

  return (
    <section className="plan-card" aria-label={t('home.planLabel')} data-testid="plan-card">
      <div className="plan-card__left">
        <h1 className="plan-card__title">{plan.title}</h1>
        <p className="plan-card__pitch">{plan.pitch}</p>
        {plan.controls.length > 0 && (
          <div className="plan-card__block">
            <h2 className="plan-card__h">{t('home.howYouPlay')}</h2>
            <ul className="plan-card__keys">
              {plan.controls.map((c, i) => (
                <li key={i}>
                  <Keycap>{c.keys}</Keycap>
                  <span>{c.does}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="plan-card__block">
          <h2 className="plan-card__h">{t('home.theTwist')}</h2>
          <div className="plan-card__twist">
            <Icon name="twist" size={28} />
            <p>
              <b>{plan.twist.name}</b>
              {plan.twist.does}
            </p>
          </div>
        </div>
      </div>

      <div className="plan-card__mid">
        <h2 className="plan-card__h plan-card__h--big">{t('home.youDrawThese')}</h2>
        <p className="plan-card__sub">{t('home.youDrawLede')}</p>
        <ol className="plan-card__cast">
          {main.map((c, i) => (
            <CastRow key={c.key} c={c} n={i + 1} drawn={Boolean(heroId) && c.key === heroKey} />
          ))}
        </ol>
        {optional.length > 0 && (
          <div className="plan-cast plan-cast--optional">
            <span className="plan-cast__glyph plan-cast__glyph--small">
              <PlaceholderGlyph rig="object" role={optional[0].role} shape="ellipse" size={34} />
            </span>
            <span className="plan-cast__text">
              <span className="plan-cast__name">{optionalLine(optional)}</span>
              <span className="plan-cast__about">{t('home.optionalRow')}</span>
            </span>
          </div>
        )}
      </div>

      <div className="plan-card__right">
        <h2 className="plan-card__h">{t('home.ambleWillBuild')}</h2>
        <ul className="plan-card__builds">
          {plan.builds.map((b, i) => (
            <li key={i}>
              <Icon name="check" size={20} />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        {plan.dials.length > 0 && (
          <ul className="plan-card__dials" aria-label={t('home.dialsYouGet')}>
            {plan.dials.map((d) => (
              <li key={d.key}>
                <Icon name="dial" size={16} />
                {d.label}
              </li>
            ))}
          </ul>
        )}
        <Button variant="quiet" size={38} icon="info" className="plan-card__how" onClick={() => setHow(true)} data-testid="how-wishes">
          {t('home.howWishesWork')}
        </Button>
        <AiExplainer open={how} onClose={() => setHow(false)} onWhatsSent={() => navigate({ name: 'page', page: 'sent' })} />
        {plan.status === 'toned_down' && plan.safetyNote && (
          <p className="plan-card__note" role="note">
            {plan.safetyNote}
          </p>
        )}
        <div className="plan-card__cta">
          <Button variant="lantern" size={58} icon="draw" busy={busy === 'draw'} disabled={busy !== null} onClick={() => void go('draw')} data-testid="plan-draw">
            {toDraw ? t('home.drawWhileBuild', { hero: toDraw.name }) : t('home.buildNow')}
          </Button>
          <Button variant="ghost" size={44} busy={busy === 'build'} disabled={busy !== null} onClick={() => void go('build')} data-testid="plan-build">
            {t('home.buildFirst')}
          </Button>
          <p className="plan-card__foot">{t('home.footnote', { hero: (toDraw ?? heroItem)?.name ?? '' })}</p>
        </div>
      </div>

      <form className="plan-card__again" onSubmit={replan}>
        <label className="plan-card__again-field">
          <Icon name="draw" size={20} />
          <span className="plan-card__again-label">{t('home.sayIt')}</span>
          <input value={again} maxLength={200} placeholder={t('home.sayItPlaceholder')} onChange={(e) => setAgain(e.target.value)} data-testid="plan-again" />
        </label>
        <Button type="submit" variant="ghost" size={44} disabled={!again.trim()} data-testid="plan-again-go">
          {t('home.replan')}
        </Button>
      </form>
    </section>
  );
}

function Fallback({ starter, idea, heroId }: { starter: StarterId; idea: string; heroId: string | null }) {
  const { starters } = useServices();
  const [busy, setBusy] = useState(false);
  const info = starters.info(starter);
  const start = async () => {
    // A second click while the world is being made would make a second world.
    if (busy) return;
    setBusy(true);
    try {
      const world = await openSeed(starter, heroId);
      clearPlanOutcome();
      navigate({ name: 'world', id: world.id });
    } catch {
      showToast(t('home.couldNotSave'), { kind: 'error' });
      setBusy(false);
    }
  };
  return (
    <section className="plan-fallback" data-testid="plan-fallback" aria-labelledby="plan-fallback-text">
      <Icon name="footprint" size={28} />
      <p id="plan-fallback-text" className="plan-fallback__text">
        {t('home.fallback', { starter: info.title })}
      </p>
      {idea && <p className="plan-fallback__idea">“{idea}”</p>}
      <div className="plan-fallback__actions">
        <Button variant="lantern" icon="play" busy={busy} onClick={() => void start()} data-testid="fallback-start">
          {t('home.startIt')}
        </Button>
        <Button variant="ghost" onClick={() => navigate({ name: 'trail', view: 'trail' })}>
          {t('home.notNow')}
        </Button>
      </div>
    </section>
  );
}

export function PlanCard() {
  const { ai, starters } = useServices();
  const session = usePlanSession();
  const [crisis, setCrisis] = useState(false);
  const asked = useRef(false);
  const outcome = session.outcome;

  const replan = (idea: string) => {
    void startPlan(ai, idea, session.hero, getState().config.level, (i) => starters.matchIdea(i));
  };

  // A reload while the plan was on its way: ask again (the words were kept). Once per visit.
  const replanRef = useRef(replan);
  replanRef.current = replan;
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    const now = getPlanSession();
    if (now.status === 'idle' && !now.outcome && now.idea) replanRef.current(now.idea);
  }, []);

  useEffect(() => {
    if (outcome?.kind === 'crisis') setCrisis(true);
    if (outcome?.kind === 'cancelled' && session.status === 'done') navigate({ name: 'new', hero: session.hero?.id ?? null, idea: true }, { replace: true });
  }, [outcome, session.status, session.hero]);

  const edit = () => {
    stopPlan();
    navigate({ name: 'new', hero: session.hero?.id ?? null, idea: true });
  };

  let body;
  if (!session.idea) {
    body = (
      <div className="plan-empty">
        <p>{t('home.noIdea')}</p>
        <Link to={{ name: 'new', hero: null, idea: true }} className="btn btn--lantern btn--h44">
          <span className="btn__label">{t('home.newWorld')}</span>
        </Link>
      </div>
    );
  } else if (session.status === 'waiting' || !outcome) {
    body = <PlanWaiting idea={session.idea} onStop={edit} className="plan-waiting--page" />;
  } else if (outcome.kind === 'plan') {
    body = <Plan plan={outcome.plan} session={session} onReplan={replan} />;
  } else if (outcome.kind === 'fallback') {
    body = <Fallback starter={outcome.starter} idea={session.idea} heroId={session.hero?.id ?? null} />;
  } else if (outcome.kind === 'refused') {
    body = (
      <div className="plan-refused">
        <RefusalCard note={outcome.note} alternatives={outcome.alternatives} onPick={replan} />
        <Button variant="ghost" icon="back" onClick={edit}>
          {t('home.edit')}
        </Button>
      </div>
    );
  } else {
    body = null;
  }

  return (
    <div className="plan-page" data-testid="screen-plan">
      <header className="home-bar on-brand plan-top">
        <Link to={{ name: 'trail', view: 'trail' }} className="home-bar__brand" aria-label={t('home.backToTrail')}>
          <Wordmark size={34} />
        </Link>
      </header>
      <main id="main" tabIndex={-1} className="plan-page__main">
        {session.idea && (
          <p className="plan-said">
            <span className="plan-said__label">{t('home.youSaid')}</span>
            <q className="plan-said__idea">{session.idea}</q>
            <button type="button" className="plan-said__edit" onClick={edit} data-testid="plan-edit">
              {t('home.edit')}
            </button>
          </p>
        )}
        {body}
      </main>
      <CrisisCard
        open={crisis}
        onClose={() => {
          setCrisis(false);
          clearPlanOutcome();
          navigate({ name: 'trail', view: 'trail' });
        }}
      />
    </div>
  );
}
