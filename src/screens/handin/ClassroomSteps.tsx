/**
 * Step 2 of Hand in (§2.13): turning the file in on Google Classroom, as four flat tiles with the words
 * and buttons the student will see there. Amble can't see Classroom, and says so.
 */
import { t } from '../../i18n';
import { Icon } from '../../ui/icons';

export function ClassroomSteps({ assignment }: { assignment: string | null }) {
  return (
    <ol className="classroom-steps">
      <li className="classroom-steps__tile">
        <span className="classroom-steps__n" aria-hidden="true">
          1
        </span>
        <span>{assignment ? t('school.stepOpen', { assignment }) : t('school.stepOpenAny')}</span>
      </li>
      <li className="classroom-steps__tile">
        <span className="classroom-steps__n" aria-hidden="true">
          2
        </span>
        <span>
          {t('school.stepPress')}{' '}
          <span className="classroom-steps__fake classroom-steps__fake--add">
            <Icon name="plus" size={14} />
            {t('school.stepAddOrCreate')}
          </span>
        </span>
      </li>
      <li className="classroom-steps__tile">
        <span className="classroom-steps__n" aria-hidden="true">
          3
        </span>
        <span>{t('school.stepPickDrive')}</span>
      </li>
      <li className="classroom-steps__tile">
        <span className="classroom-steps__n" aria-hidden="true">
          4
        </span>
        <span>
          {t('school.stepPress')} <span className="classroom-steps__fake classroom-steps__fake--turnin">{t('school.stepTurnIn')}</span>
        </span>
      </li>
    </ol>
  );
}
