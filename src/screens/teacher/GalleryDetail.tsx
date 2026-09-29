/**
 * The gallery's detail panel (§2.14): the chosen world playing (one at a time, muted until the teacher turns
 * sound on), ◀ 3 of 24 ▶, the keys, the assignment checklist with evidence (Amble's rows marked "auto", the
 * teacher's as checkboxes), **How it was built**, and a feedback box with **Copy** for Classroom. Notes and
 * checks stay on this device under the file's content hash.
 */
import { useId, useMemo, useRef } from 'react';
import { useCommand, useEscape } from '../../app/keys';
import { t } from '../../i18n';
import type { ArtId, GalleryNote } from '../../model/types';
import { goalsFor, runChecks, teacherEvidence, type ArtFacts } from '../../school/checks';
import { codeFacts } from '../../school/codeFacts';
import { tn } from '../../school/count';
import type { GalleryItem } from '../../school/gallery';
import { formatMinutes } from '../../school/story';
import { updateTeacherData, useTeacherData } from '../../school/teacherData';
import { announce, showToast } from '../../state/app';
import { Footprints, IconButton, Keycap, TextArea } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { Check } from './Check';
import { SchoolIcon } from './SchoolIcon';
import { TButton } from './TButton';
import { useGalleryPlayer } from './useGalleryPlayer';

export function noteFor(item: GalleryItem, notes: Record<string, GalleryNote>): GalleryNote {
  return notes[item.id] ?? { fileHash: item.id, title: item.title.slice(0, 80), madeBy: item.madeBy.slice(0, 20), checks: {}, feedback: '', reviewedAt: null };
}

export function editNote(item: GalleryItem, fn: (n: GalleryNote) => GalleryNote): void {
  updateTeacherData((d) => ({ ...d, notes: { ...d.notes, [item.id]: { ...fn(noteFor(item, d.notes)), reviewedAt: Date.now() } } }));
}

export interface GalleryDetailProps {
  item: GalleryItem;
  index: number;
  total: number;
  showNames: boolean;
  onMove(delta: -1 | 1): void;
  /** Small windows: the panel is a full-screen view with a Back button. */
  onBack?: () => void;
}

export function GalleryDetail({ item, index, total, showNames, onMove, onBack }: GalleryDetailProps) {
  const teacher = useTeacherData();
  const note = noteFor(item, teacher.notes);
  const slot = useRef<HTMLDivElement>(null);
  const game = useGalleryPlayer(item, slot);
  const ids = { checks: useId(), story: useId(), feedback: useId() };

  useCommand('restart', () => (game.state === 'playing' ? (game.restart(), true) : false));
  useCommand('fullscreen', () => (game.state === 'playing' ? (game.fullscreen(), true) : false));
  useEscape(() => (game.state === 'playing' ? (game.stop(), true) : false), game.state === 'playing');

  const world = item.world;
  const outcomes = useMemo(() => {
    if (!world) return [];
    const art = new Map<ArtId, ArtFacts>(item.art);
    for (const record of game.file?.art ?? []) art.set(record.id, { madeBy: record.madeBy, onBones: record.mode === 'bones' || record.rigInfo?.made === 'parts' });
    return runChecks(goalsFor(world, item.cast), { world, cast: item.cast, art: (id) => art.get(id) ?? null, facts: codeFacts(world.code), robot: game.robot ?? null });
  }, [world, item.cast, item.art, game.file, game.robot]);
  const autoCount = outcomes.filter((o) => o.pass !== null).length;
  const story = item.story;
  const by = showNames && item.madeBy ? item.madeBy : null;

  const copy = async () => {
    const text = note.feedback.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('school.staff_feedbackCopied'), { kind: 'success' });
    } catch {
      showToast(t('school.staff_feedbackCopyByHand'));
    }
    editNote(item, (n) => n);
  };

  return (
    <section className="gdetail tpanel" aria-labelledby={`${ids.checks}-title`} data-testid="gallery-detail">
      <div className="gdetail__head">
        {onBack && <IconButton icon="back" label={t('school.staff_backToGrid')} variant="ghost" size={38} onClick={onBack} />}
        <h3 id={`${ids.checks}-title`} className="gdetail__title">
          {item.title}
          {by && <span className="gdetail__by">{t('school.staff_by', { name: by })}</span>}
        </h3>
        <div className="gdetail__nav">
          <IconButton icon="back" label={t('school.staff_prevWorld')} variant="ghost" size={38} onClick={() => onMove(-1)} disabled={total < 2} />
          <span className="gdetail__count">{t('school.staff_nOfTotal', { n: index + 1, total })}</span>
          <button type="button" className="btn btn--ghost btn--h38 btn--icon" aria-label={t('school.staff_nextWorld')} onClick={() => onMove(1)} disabled={total < 2}>
            <SchoolIcon name="next" size={20} />
          </button>
        </div>
      </div>

      <div className={cx('gdetail__view', `gdetail__view--${game.state}`)} ref={slot} data-testid="gallery-slot">
        {game.state !== 'playing' && item.thumb && <img className="gdetail__poster" src={item.thumb} alt="" />}
        {game.state === 'loading' && (
          <span className="gdetail__over">
            <Footprints label={t('school.staff_starting')} />
            {t('school.staff_starting')}
          </span>
        )}
        {game.state === 'stopped' && (
          <button type="button" className="gdetail__over gdetail__over--button" onClick={game.start}>
            <Icon name="play" size={22} />
            {t('school.staff_playAgain')}
          </button>
        )}
        {game.state === 'failed' && (
          <span className="gdetail__over gdetail__over--bad">
            <Icon name="warning" size={20} />
            {t('school.staff_cantStart')}
          </span>
        )}
      </div>
      <div className="gdetail__keys">
        <span>
          <Keycap label={t('school.staff_keyLeft')}>←</Keycap>
          <Keycap label={t('school.staff_keyRight')}>→</Keycap> {t('school.staff_keysOther')}
        </span>
        <span>
          <Keycap>R</Keycap> {t('school.staff_keysRestart')}
        </span>
        <span>
          <Keycap>F</Keycap> {t('school.staff_keysFull')}
        </span>
        <span>
          <Keycap>Esc</Keycap> {t('school.staff_keysStop')}
        </span>
        <IconButton icon="sound" label={game.muted ? t('school.staff_soundTurnOn') : t('school.staff_soundTurnOff')} pressed={!game.muted} size={38} variant="ghost" onClick={game.toggleSound} disabled={game.state !== 'playing'} className="gdetail__sound" />
      </div>

      <div className="gdetail__scroll">
        <section className="gbox" aria-labelledby={ids.checks}>
          <h4 id={ids.checks} className="gbox__h">
            <Icon name="check" size={18} />
            {t('school.staff_asgChecklist')}
            <small>{t('school.staff_checkedByAmble', { n: autoCount, total: outcomes.length })}</small>
          </h4>
          <ul className="gchecks">
            {outcomes.map((o) => {
              if (o.pass === null) {
                const on = Boolean(note.checks[o.goal.id]);
                return (
                  <li key={o.goal.id} className="gchecks__row gchecks__row--teacher">
                    <Check checked={on} onChange={() => editNote(item, (n) => ({ ...n, checks: { ...n.checks, [o.goal.id]: !on } }))} className="gchecks__teacher">
                      {o.goal.label}
                    </Check>
                    <span className="gchecks__ev">{teacherEvidence(o.evidence)}</span>
                  </li>
                );
              }
              const testing = o.evidence.kind === 'untested' && game.robot === undefined && game.state !== 'failed';
              return (
                <li key={o.goal.id} className={cx('gchecks__row', o.pass ? 'gchecks__row--pass' : testing ? 'gchecks__row--testing' : 'gchecks__row--fail')}>
                  <span className="gchecks__box" aria-hidden="true">
                    {o.pass ? <Icon name="check" size={14} /> : testing ? null : <Icon name="warning" size={12} />}
                  </span>
                  <span className="gchecks__label">
                    {o.goal.label}
                    <span className="sr-only">{`: ${o.pass ? t('school.staff_checkPass') : testing ? t('school.staff_checkTesting') : t('school.staff_checkFail')}`}</span>
                  </span>
                  <span className="gchecks__ev">{testing ? t('school.staff_testingShort') : teacherEvidence(o.evidence)}</span>
                </li>
              );
            })}
          </ul>
        </section>

        {story && (
          <section className="gbox" aria-labelledby={ids.story}>
            <h4 id={ids.story} className="gbox__h">
              <SchoolIcon name="clock" size={18} />
              {t('school.staff_howBuilt')}
              <small>{tn('school.staff_sessions', story.sessions, { time: formatMinutes(story.minutes) })}</small>
            </h4>
            <p className="gbox__chips">
              <span className="gstat gstat--draw">
                <Icon name="draw" size={16} />
                {by ? tn('school.staff_drawingsBy', story.drawings, { name: by }) : tn('school.staff_drawingsN', story.drawings)}
              </span>
              <span className="gstat gstat--ai">
                <Icon name="sparkle" size={16} />
                {tn('school.staff_aiChanges', story.aiChanges)}
              </span>
              <span className="gstat">
                <SchoolIcon name="code" size={16} />
                {tn('school.staff_codeEdits', story.codeEdits)}
              </span>
            </p>
            {story.requests.length > 0 && (
              <ul className="gquotes">
                {story.requests.slice(0, 3).map((r, i) => (
                  <li key={i}>
                    <Icon name="sparkle" size={16} />
                    <q>{r}</q>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <div className="gdetail__feedback">
        <TextArea
          id={ids.feedback}
          label={t('school.staff_feedbackLabel')}
          labelHidden
          placeholder={t('school.staff_feedbackPlaceholder')}
          value={note.feedback}
          maxLength={4000}
          rows={2}
          onChange={(e) => editNote(item, (n) => ({ ...n, feedback: e.target.value }))}
          onBlur={() => note.feedback && announce(t('school.staff_feedbackKept'))}
        />
        <TButton variant="lantern" icon="copy" onClick={() => void copy()} disabled={!note.feedback.trim()} testId="copy-feedback">
          {t('school.staff_copy')}
        </TButton>
      </div>
    </section>
  );
}
