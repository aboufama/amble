/**
 * The student's checklist at Hand in (§2.13): each goal with what Amble found, a Fix it link for anything
 * missing, and "Your teacher checks this" for the teacher's own goals. Never blocks handing in.
 */
import { Link } from '../../app/Link';
import { t } from '../../i18n';
import type { WorldId } from '../../model/types';
import type { CastInfo } from '../../school/assignment';
import { studentEvidence, studentLabel, type CheckOutcome } from '../../school/checks';
import { Footprints } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';

export interface ChecklistProps {
  worldId: WorldId;
  cast: readonly CastInfo[];
  outcomes: readonly CheckOutcome[] | null;
  /** The robot test is running (the "Runs with no errors" row says so). */
  testing: boolean;
  onRetest(): void;
}

function FixLink({ worldId, outcome, onRetest }: { worldId: WorldId; outcome: CheckOutcome; onRetest(): void }) {
  const fix = outcome.fix;
  if (!fix || outcome.pass) return null;
  switch (fix.kind) {
    case 'draw':
      return (
        <Link to={{ name: 'draw', worldId, key: fix.key }} className="checklist__fix">
          {t('school.fixDraw')}
        </Link>
      );
    case 'code':
      return (
        <Link to={{ name: 'code', worldId, file: null }} className="checklist__fix">
          {t('school.fixCode')}
        </Link>
      );
    case 'world':
      return (
        <Link to={{ name: 'world', id: worldId }} className="checklist__fix">
          {t('school.fixIt')}
        </Link>
      );
    case 'retest':
      return (
        <button type="button" className="checklist__fix checklist__fix--button" onClick={onRetest}>
          {t('school.fixRetest')}
        </button>
      );
  }
}

export function Checklist({ worldId, cast, outcomes, testing, onRetest }: ChecklistProps) {
  if (!outcomes) {
    return (
      <div className="checklist__loading" role="status">
        <Footprints label={t('school.checking')} />
        <span>{t('school.checking')}</span>
      </div>
    );
  }
  return (
    <ul className="checklist">
      {outcomes.map((o) => {
        const isTest = o.goal.kind === 'auto' && o.goal.check.type === 'runs-clean';
        const running = isTest && testing;
        const state = o.pass === null ? 'teacher' : running ? 'running' : o.pass ? 'pass' : 'fail';
        const label = studentLabel(o.goal, cast);
        const evidence = running ? t('school.testingNow') : studentEvidence(o.evidence);
        const said = state === 'pass' ? t('school.checkDone') : state === 'fail' ? t('school.checkNotYet') : state === 'teacher' ? t('school.checkTeacher') : t('school.checkRunning');
        return (
          <li key={o.goal.id} className={cx('checklist__item', `checklist__item--${state}`)}>
            <span className="checklist__box" aria-hidden="true">
              {state === 'pass' && <Icon name="check" size={16} />}
              {state === 'fail' && <Icon name="warning" size={14} />}
              {state === 'teacher' && <Icon name="teacher" size={14} />}
              {state === 'running' && <span className="checklist__spin" />}
            </span>
            <span className="checklist__words">
              <span className="checklist__label">
                {label}
                <span className="sr-only">{`: ${said}.`}</span>
              </span>
              <span className="checklist__evidence">
                {evidence} {!running && <FixLink worldId={worldId} outcome={o} onRetest={onRetest} />}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
