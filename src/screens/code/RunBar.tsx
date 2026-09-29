/**
 * The run bar under the editor (§2.12): what is running ("You changed boss.js. Press Run it to play it."),
 * why a run was held back ("Not running your changes yet: 1 problem on line 31.") with **Show me**, runtime
 * breaks, and unrun changes from an older version with **Bring them back**.
 */
import { t } from '../../i18n';
import { Button, Footprints, Keycap } from '../../ui/components';
import { Icon, type IconName } from '../../ui/icons';
import { cx } from '../../ui/cx';
import type { RunState } from './session';

export interface RunBarProps {
  run: RunState;
  message: string;
  oldDraft: boolean;
  onShow(): void;
  onBringBack(): void;
}

const LOOK: Record<RunState['kind'], { icon: IconName | null; tone: string }> = {
  clean: { icon: 'check', tone: 'alive' },
  dirty: { icon: 'draw', tone: 'accent' },
  starting: { icon: null, tone: 'accent' },
  done: { icon: 'check', tone: 'alive' },
  blocked: { icon: 'warning', tone: 'warn' },
  failed: { icon: 'warning', tone: 'warn' },
  runtime: { icon: 'warning', tone: 'warn' },
};

export function RunBar({ run, message, oldDraft, onShow, onBringBack }: RunBarProps) {
  const look = LOOK[run.kind];
  const canShow = run.kind === 'blocked' || ((run.kind === 'runtime' || run.kind === 'failed') && run.line !== null);
  return (
    <div className={cx('run-bar', `run-bar--${look.tone}`)} data-testid="run-bar" data-run={run.kind}>
      <p className="run-bar__status">
        {look.icon ? <Icon name={look.icon} size={18} className="run-bar__icon" /> : <Footprints label={message} />}
        <span className="run-bar__text">{message}</span>
        {canShow && (
          <Button variant="quiet" size={38} className="run-bar__show" onClick={onShow}>
            {t('history.showMe')}
          </Button>
        )}
      </p>
      {oldDraft ? (
        <p className="run-bar__draft">
          <Icon name="info" size={16} />
          <span>{t('history.draftOld')}</span>
          <Button variant="ghost" size={38} onClick={onBringBack}>
            {t('history.draftBring')}
          </Button>
        </p>
      ) : (
        <p className="run-bar__keys" aria-hidden="true">
          {t('history.runKeys')
            .split('+')
            .map((key) => (
              <Keycap key={key}>{key}</Keycap>
            ))}
          <span>{t('history.runIt')}</span>
        </p>
      )}
    </div>
  );
}
