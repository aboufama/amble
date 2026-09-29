/**
 * "New version ready: {summary}" [Play it now] (§2.6): an accepted AI change waits while the student is
 * in the middle of playing; it loads by itself at the next pause, win, loss or 5 s of idle.
 */
import { t } from '../../i18n';
import { playNewVersion } from '../../state/session';
import { useStore } from '../../state/store';
import { Button } from '../../ui/components';
import { Icon } from '../../ui/icons';

export function NewVersionCard() {
  const next = useStore((s) => s.session.newVersion);
  if (!next?.ready) return null;
  return (
    <div className="new-version" role="status" data-testid="new-version">
      <Icon name="sparkle" size={20} className="new-version__icon" />
      <p className="new-version__text">{next.summary ? t('world.newVersion', { summary: next.summary }) : t('world.newVersionPlain')}</p>
      <Button variant="lantern" size={38} icon="play" onClick={playNewVersion}>
        {t('world.playItNow')}
      </Button>
    </div>
  );
}
