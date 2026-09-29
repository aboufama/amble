/**
 * The wish box's shell (§2.8): the side panel's top panel, headed **Change your world**. Everything inside
 * (the field, idea chips, working, outcomes, the resting and error lines, the scope chip) is the wish box's
 * own `AskStates`; Change mode's selection scopes it to one member. When the wish box shows nothing (wishes
 * are hidden here), the panel goes with it.
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
      <h2 id="ask-card-title" className="ask-card__title">
        {t('world.askTitle')}
      </h2>
      <div className="ask-card__body">
        <AskStates world={world} manifest={manifest} scope={scope} onClearScope={() => setScope(null)} />
      </div>
    </section>
  );
}
