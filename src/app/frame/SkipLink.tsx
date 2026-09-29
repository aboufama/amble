/** The first focusable element (§3.9): "Skip to the game" where a world runs, else "Skip to main content". */
import { t } from '../../i18n';
import { hasGame, type Route } from '../routes';

export function SkipLink({ route }: { route: Route }) {
  const game = hasGame(route);
  const go = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const target = (game && document.getElementById('game')) || document.getElementById('main');
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus();
  };
  return (
    <a className="skip-link" href={game ? '#game' : '#main'} onClick={go}>
      {game ? t('common.skipToGame') : t('common.skipToMain')}
    </a>
  );
}
