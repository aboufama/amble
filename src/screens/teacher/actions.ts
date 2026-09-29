/** Teacher desk actions shared by the tabs. */
import { navigate } from '../../app/router';
import { t } from '../../i18n';
import type { Assignment, ClassLinkV1 } from '../../model/types';
import { semesterEnd } from '../../school/classLink';
import { updateTeacherData } from '../../school/teacherData';
import { showToast } from '../../state/app';

/** The draft class link when the teacher has not started one. */
export function blankLink(): ClassLinkV1 {
  return { v: 1, cls: '', district: null, ai: null, mode: 'on', level: 'middle', exp: semesterEnd(), asg: null };
}

/** Attaches an assignment (on a built-in starter) to the class link and shows the link. */
export function putInLink(asg: Assignment): void {
  updateTeacherData((d) => ({ ...d, link: { ...(d.link ?? blankLink()), asg } }));
  showToast(t('school.staff_asgInLink', { title: asg.title || t('school.staff_asgUntitled') }), { kind: 'success' });
  navigate({ name: 'teacher', tab: 'link' });
}
