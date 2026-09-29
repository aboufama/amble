/**
 * The teacher's assignment on the Trail (§2.4): a white board on two posts by the lamppost while the
 * assignment has no world yet. **Start** makes the world from the assignment's starter as a seed and opens
 * the Desk on its hero, on the bones (draw first).
 */
import { useState } from 'react';
import { navigate } from '../../app/router';
import { t } from '../../i18n';
import { createAssignmentWorld } from '../../home/createWorld';
import type { Assignment } from '../../model/types';
import { showToast } from '../../state/app';
import { Button, Chip } from '../../ui/components';

/** "moonKing" → "moon king" (the assignment lists cast keys). */
export function keyWords(key: string): string {
  if (key === 'hero') return t('home.asgYourHero');
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

/** `feet` is where its posts stand (design px, bottom-anchored): the board grows upward from there. */
export function AssignmentNote({ assignment, left, feet }: { assignment: Assignment; left: number; feet: number }) {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { world, heroKey } = await createAssignmentWorld(assignment);
      navigate({ name: 'draw', worldId: world.id, key: heroKey });
    } catch (err) {
      console.warn('The assignment could not start:', err);
      showToast(t('home.couldNotSave'), { kind: 'error' });
      setBusy(false);
    }
  };
  const draws = assignment.require.length ? assignment.require.map(keyWords).join(', ') : t('home.asgYourHero');
  return (
    <div className="trail-stop assignment-note" style={{ left, top: `calc(100% - 768px + ${feet}px)` }} data-testid="assignment-note">
      <div className="assignment-note__paper">
        <p className="assignment-note__from">{t('home.fromTeacher')}</p>
        <p className="assignment-note__title">{assignment.title}</p>
        {assignment.text && <p className="assignment-note__text">{assignment.text}</p>}
        <div className="assignment-note__chips">
          <Chip>{t('home.asgYouDraw', { list: draws })}</Chip>
        </div>
        <div className="assignment-note__foot">
          <Button variant="lantern" size={38} icon="draw" busy={busy} onClick={() => void start()} data-testid="assignment-start">
            {t('home.asgStart')}
          </Button>
          {assignment.due && <span className="assignment-note__due">{t('home.asgDue', { due: assignment.due })}</span>}
        </div>
      </div>
      <span className="assignment-note__legs" aria-hidden="true" />
    </div>
  );
}
