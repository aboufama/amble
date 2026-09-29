/**
 * The Ask card's shell (§2.8): the notebook's top panel, **Change your world** with the AI HELPER badge.
 * Everything inside (the field, idea chips, progress, outcomes, the off and error copy, the scope chip)
 * is the AI pipeline's `AskStates`; Change mode's selection scopes it to one member.
 */
import { t } from '../../i18n';
import type { World } from '../../model/types';
import { setScope } from '../../state/session';
import { useStore } from '../../state/store';
import { AskStates } from '../ai/AskStates';

export function AskCard({ world }: { world: World }) {
  const manifest = useStore((s) => s.session.manifest);
  const scope = useStore((s) => s.session.scope);
  return (
    <section className="panel ask-card" aria-labelledby="ask-card-title" data-testid="ask-card">
      <div className="ask-card__head">
        <h2 id="ask-card-title" className="ask-card__title">
          {t('world.askTitle')}
        </h2>
        <span className="ask-card__badge">{t('world.askBadge')}</span>
      </div>
      <AskStates world={world} manifest={manifest} scope={scope} onClearScope={() => setScope(null)} />
    </section>
  );
}
