/**
 * Teacher desk → Assignments (§2.14): the assignments made on this device, **New assignment**, and for each
 * one **Put it in the class link** (built-in starters) or **Save assignment file** (a `.amble` of kind
 * `assignment`, attached in Classroom as "Students can view file").
 */
import { useState } from 'react';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { tn } from '../../school/count';
import type { Assignment } from '../../model/types';
import { fitsInLink, newAssignment } from '../../school/assignment';
import { updateTeacherData, useTeacherData } from '../../school/teacherData';
import { showToast } from '../../state/app';
import { Button, Chip } from '../../ui/components';
import { confirmUser } from '../../ui/dialogs';
import { putInLink } from './actions';
import { AssignmentEditor, saveAssignmentFile } from './AssignmentEditor';
import { LEVEL_WORDS } from './ClassLinkTab';
import { SchoolIcon } from './SchoolIcon';
import { TButton } from './TButton';

export function AssignmentsTab() {
  const services = useServices();
  const teacher = useTeacherData();
  const [editing, setEditing] = useState<Assignment | null>(null);
  const inLink = teacher.link?.asg?.id ?? null;

  if (editing) {
    return (
      <AssignmentEditor
        initial={editing}
        onDone={(saved) => {
          setEditing(null);
          if (saved) showToast(t('school.staff_asgSaved'), { kind: 'success' });
        }}
      />
    );
  }

  const remove = async (a: Assignment) => {
    const ok = await confirmUser({ title: t('school.staff_asgDeleteTitle', { title: a.title || t('school.staff_asgUntitled') }), body: t('school.staff_asgDeleteBody'), ok: t('school.staff_delete'), danger: true });
    if (!ok) return;
    updateTeacherData((d) => ({ ...d, assignments: d.assignments.filter((x) => x.id !== a.id), link: d.link && d.link.asg?.id === a.id ? { ...d.link, asg: null } : d.link }));
  };

  const starterName = (a: Assignment) => {
    if (!a.starter) return t('school.staff_asgOwnWorld');
    try {
      const info = services.starters.info(a.starter);
      return `${info.title} · ${info.genre}`;
    } catch {
      return a.starter;
    }
  };

  return (
    <div className="asg" data-testid="teacher-assignments">
      <div className="asg__head">
        <div>
          <h2 className="teacher__h1">{t('school.staff_asgTitle')}</h2>
          <p className="teacher__lede">{t('school.staff_asgLede')}</p>
        </div>
        <Button variant="lantern" icon="plus" onClick={() => setEditing(newAssignment())}>
          {t('school.staff_asgNew')}
        </Button>
      </div>

      {teacher.assignments.length === 0 ? (
        <div className="tempty">
          <SchoolIcon name="clipboard" size={40} />
          <p className="tempty__title">{t('school.staff_asgEmpty')}</p>
          <p className="tempty__text">{t('school.staff_asgEmptyHint')}</p>
        </div>
      ) : (
        <ul className="asg__list">
          {teacher.assignments.map((a) => (
            <li key={a.id} className="asg-card tpanel">
              <div className="asg-card__main">
                <h3 className="asg-card__title">{a.title || t('school.staff_asgUntitled')}</h3>
                <p className="asg-card__meta">
                  {starterName(a)}
                  {a.due && ` · ${t('school.staff_asgDue', { due: a.due })}`}
                </p>
                <p className="asg-card__chips">
                  <Chip>{tn('school.staff_asgGoals', a.goals.length)}</Chip>
                  <Chip dot={a.ai === 'off' ? 'off' : 'ai'}>{t('school.staff_asgAi', { mode: t(a.ai === 'on' ? 'school.staff_modeOn' : a.ai === 'explain' ? 'school.staff_modeExplain' : 'school.staff_modeOff') })}</Chip>
                  {a.level && <Chip>{t(`school.${LEVEL_WORDS[a.level]}`)}</Chip>}
                  {inLink === a.id && (
                    <Chip dot="alive" className="asg-card__inlink">
                      {t('school.staff_asgInLinkBadge')}
                    </Chip>
                  )}
                </p>
              </div>
              <div className="asg-card__actions">
                <Button variant="ghost" size={38} icon="draw" onClick={() => setEditing(a)}>
                  {t('school.staff_edit')}
                </Button>
                {fitsInLink(a) && inLink !== a.id && (
                  <TButton variant="ghost" size={38} icon="link" onClick={() => putInLink(a)}>
                    {t('school.staff_asgPutInLink')}
                  </TButton>
                )}
                <TButton variant="ghost" size={38} icon="download" onClick={() => void saveAssignmentFile(services, a)}>
                  {t('school.staff_asgSaveFile')}
                </TButton>
                <TButton variant="quiet" size={38} icon="trash" onClick={() => void remove(a)} aria-label={t('school.staff_deleteNamed', { title: a.title || t('school.staff_asgUntitled') })}>
                  {t('school.staff_delete')}
                </TButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
