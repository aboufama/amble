/**
 * Twists (§2.7): a 2-column grid of flat switch tiles (picture, name, the shared switch) for the twists this
 * world can take; the ones it cannot take are hidden, not greyed. They change the running game at once.
 */
import { useMemo } from 'react';
import { t } from '../../i18n';
import { setTwist } from '../../state/session';
import { useStore } from '../../state/store';
import { cx } from '../../ui/cx';
import { TwistIcon } from './twistIcons';

export function TwistsCard() {
  const all = useStore((s) => s.session.manifest?.twists);
  const twists = useMemo(() => (all ?? []).filter((x) => x.available), [all]);
  return (
    <div className="twists" data-testid="twists">
      {twists.length ? (
        <ul className="twists__grid">
          {twists.map((tw) => (
            <li key={tw.id}>
              <button
                type="button"
                role="switch"
                aria-checked={tw.on}
                aria-describedby={`twist-${tw.id}-does`}
                className={cx('twist-tile', tw.on && 'twist-tile--on')}
                onClick={() => setTwist(tw.id, !tw.on)}
                data-testid={`twist-${tw.id}`}
              >
                <TwistIcon id={tw.id} />
                <span className="twist-tile__name">{tw.name}</span>
                <span className={cx('toggle__switch twist-tile__switch', tw.on && 'toggle__switch--on')} aria-hidden="true">
                  <span className="toggle__knob" />
                </span>
                <span id={`twist-${tw.id}-does`} className="sr-only">
                  {tw.does}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tune__empty">{t('world.noTwists')}</p>
      )}
      <p className="tune__note">{t('world.twistsNote')}</p>
    </div>
  );
}
