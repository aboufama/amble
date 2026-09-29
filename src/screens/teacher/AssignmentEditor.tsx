/**
 * The assignment editor (§2.14): title, instructions (students can have them read aloud), starter (any
 * starter, or a world made on this device), required drawings from its cast, goals (the auto-checkable menu
 * plus the teacher's own), AI for this assignment, content level, locked lines and due text.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { useServices, type Services } from '../../app/services';
import { t } from '../../i18n';
import type { AiMode, Assignment, CodeFile, Level, StarterId, WorldMeta } from '../../model/types';
import {
  assignmentFileName,
  assignmentWorld,
  AUTO_GOALS,
  autoGoalAvailable,
  autoGoalLabel,
  castFromCode,
  castOfStarter,
  drawableCast,
  fitsInLink,
  makeAutoGoal,
  makeTeacherGoal,
  menuIdOf,
  type AutoGoalId,
  type CastInfo,
} from '../../school/assignment';
import { updateTeacherData } from '../../school/teacherData';
import { showToast } from '../../state/app';
import { LEVELS } from '../../state/config';
import { useStore } from '../../state/store';
import { Button, Dialog, Field, Segmented, TextArea, roleWord } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { putInLink } from './actions';
import { CappedChoice } from './CappedChoice';
import { Check } from './Check';
import { LEVEL_SHORT, LEVEL_WORDS } from './ClassLinkTab';
import { TButton } from './TButton';

/** Which world an assignment starts from: a built-in starter, or one of the teacher's worlds ("own:<id>"). */
type Base = { kind: 'starter'; id: StarterId } | { kind: 'own'; id: string };

function baseKey(b: Base): string {
  return b.kind === 'starter' ? b.id : `own:${b.id}`;
}

async function baseCode(services: Services, base: Base): Promise<CodeFile[]> {
  if (base.kind === 'starter') return (await services.starters.open(base.id, { withArt: false })).world.code;
  return (await services.store.worlds.get(base.id))?.code ?? [];
}

/** Writes the assignment as a `.amble` of kind `assignment` and saves it (Drive or Downloads). */
export async function saveAssignmentFile(services: Services, asg: Assignment, ownWorld: string | null = null): Promise<void> {
  try {
    const base = ownWorld ? await services.store.worlds.get(ownWorld) : (await services.starters.open(asg.starter ?? 'moon-king', { withArt: false })).world;
    if (!base) throw new Error('missing world');
    const world = assignmentWorld(base, asg);
    const saved = await services.files.saveBlob(() => services.files.write(world, 'assignment'), assignmentFileName(asg), 'amble');
    if (saved) showToast(saved.method === 'fs-access' ? t('school.staff_asgFileSaved', { name: saved.name }) : t('school.staff_asgFileDownloaded', { name: saved.name }), { kind: 'success' });
  } catch {
    showToast(t('school.staff_asgFileFailed'), { kind: 'error' });
  }
}

/** The teacher's worlds on this device, newest first ("Use a world I made"). */
function useOwnWorlds(): WorldMeta[] {
  const { store } = useServices();
  const [worlds, setWorlds] = useState<WorldMeta[]>([]);
  useEffect(() => {
    let live = true;
    void store.worlds
      .list()
      .then((list) => live && setWorlds(list.filter((w) => !w.putAwayAt).sort((a, b) => b.updatedAt - a.updatedAt)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [store]);
  return worlds;
}

function LockLines({ code, locked, onChange, onClose }: { code: CodeFile[]; locked: Record<string, Array<[number, number]>>; onChange(next: Record<string, Array<[number, number]>>): void; onClose(): void }) {
  const [path, setPath] = useState(code.find((f) => f.path === 'game.js')?.path ?? code[0]?.path ?? '');
  const file = code.find((f) => f.path === path);
  const lines = file ? file.source.split('\n') : [];
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const ranges = locked[path] ?? [];
  const isLocked = (n: number) => ranges.some(([a, b]) => n >= a && n <= b);
  const lo = Math.min(Number(from) || 0, Number(to) || Number(from) || 0);
  const hi = Math.max(Number(from) || 0, Number(to) || Number(from) || 0);
  const valid = lo >= 1 && hi <= lines.length && lo <= hi;
  const lock = () => {
    if (!valid) return;
    onChange({ ...locked, [path]: [...ranges, [lo, hi] as [number, number]].sort((a, b) => a[0] - b[0]) });
    setFrom('');
    setTo('');
  };
  const pick = (n: number, extend: boolean) => {
    if (extend && from) setTo(String(n));
    else {
      setFrom(String(n));
      setTo('');
    }
  };
  return (
    <Dialog open size="lg" title={t('school.staff_lockTitle')} onClose={onClose} className="locklines" actions={<Button variant="lantern" onClick={onClose}>{t('school.staff_done')}</Button>}>
      <p className="dialog__text">{t('school.staff_lockHelp')}</p>
      {code.length > 1 && (
        <Segmented label={t('school.staff_lockFile')} size={38} options={code.map((f) => ({ value: f.path, label: f.path }))} value={path} onChange={(p) => setPath(p)} />
      )}
      <div className="locklines__pick">
        <Field label={t('school.staff_lockFrom')} type="number" min={1} max={lines.length} value={from} onChange={(e) => setFrom(e.target.value)} />
        <Field label={t('school.staff_lockTo')} type="number" min={1} max={lines.length} value={to} onChange={(e) => setTo(e.target.value)} />
        <Button variant="ghost" icon="lock" onClick={lock} disabled={!valid}>
          {valid ? t('school.staff_lockLines', { from: lo, to: hi }) : t('school.staff_lock')}
        </Button>
      </div>
      {ranges.length > 0 && (
        <ul className="locklines__ranges">
          {ranges.map(([a, b], i) => (
            <li key={`${a}-${b}`}>
              <Icon name="lock" size={16} />
              {t('school.staff_lockRange', { from: a, to: b })}
              <button type="button" className="locklines__remove" onClick={() => onChange({ ...locked, [path]: ranges.filter((_, j) => j !== i) })}>
                {t('school.staff_unlock')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ol className="locklines__code mono" aria-label={t('school.staff_lockCodeLabel', { file: path })}>
        {lines.map((line, i) => {
          const n = i + 1;
          const chosen = valid && n >= lo && n <= hi;
          return (
            <li key={n} className={cx('locklines__line', isLocked(n) && 'locklines__line--locked', chosen && 'locklines__line--chosen')} onClick={(e) => pick(n, e.shiftKey)}>
              <span className="locklines__n" aria-hidden="true">
                {n}
              </span>
              <span className="locklines__text">{line || ' '}</span>
            </li>
          );
        })}
      </ol>
    </Dialog>
  );
}

export function AssignmentEditor({ initial, onDone }: { initial: Assignment; onDone(saved: boolean): void }) {
  const services = useServices();
  const levelMax = useStore((s) => s.config.levelMax);
  const ownWorlds = useOwnWorlds();
  const [asg, setAsg] = useState<Assignment>(initial);
  const [base, setBase] = useState<Base>(initial.starter ? { kind: 'starter', id: initial.starter } : { kind: 'own', id: '' });
  const [cast, setCast] = useState<CastInfo[] | null>(null);
  const [code, setCode] = useState<CodeFile[]>([]);
  const [newGoal, setNewGoal] = useState('');
  const [locking, setLocking] = useState(false);
  const ids = { base: useId(), goals: useId(), req: useId() };
  const starters = useMemo(() => services.starters.list(), [services.starters]);

  useEffect(() => {
    let live = true;
    setCast(null);
    if (base.kind === 'own' && !base.id) {
      setCast([]);
      setCode([]);
      return;
    }
    void baseCode(services, base).then(async (files) => {
      if (!live) return;
      setCode(files);
      setCast(base.kind === 'starter' ? await castOfStarter(services.starters, base.id) : castFromCode(files));
    });
    return () => {
      live = false;
    };
  }, [base, services]);

  const patch = (p: Partial<Assignment>) => setAsg((a) => ({ ...a, ...p }));
  const members = cast ?? [];
  const drawable = useMemo(() => drawableCast(cast ?? []), [cast]);
  const chosenGoals = new Set(asg.goals.map((g) => menuIdOf(g, members)).filter((x): x is AutoGoalId => x !== null));

  const toggleGoal = (id: AutoGoalId) => {
    if (chosenGoals.has(id)) patch({ goals: asg.goals.filter((g) => menuIdOf(g, members) !== id) });
    else {
      const goal = makeAutoGoal(id, members);
      if (goal) patch({ goals: [...asg.goals, goal] });
    }
  };

  const toggleRequired = (key: string) => {
    patch({ require: asg.require.includes(key) ? asg.require.filter((k) => k !== key) : [...asg.require, key] });
  };

  const addTeacherGoal = () => {
    const label = newGoal.trim();
    if (!label) return;
    patch({ goals: [...asg.goals, makeTeacherGoal(label)] });
    setNewGoal('');
  };

  const saved = (): Assignment => {
    const next: Assignment = { ...asg, title: asg.title.trim().slice(0, 60), text: asg.text.trim().slice(0, 400), due: asg.due.trim().slice(0, 40), starter: base.kind === 'starter' ? base.id : null };
    updateTeacherData((d) => {
      const exists = d.assignments.some((a) => a.id === next.id);
      const assignments = exists ? d.assignments.map((a) => (a.id === next.id ? next : a)) : [next, ...d.assignments];
      const link = d.link && d.link.asg?.id === next.id ? { ...d.link, asg: fitsInLink(next) ? next : null } : d.link;
      return { ...d, assignments, link };
    });
    return next;
  };

  const levelOptions: Array<{ value: Level | 'class'; label: string; aria?: string }> = [
    { value: 'class', label: t('school.staff_levelClass') },
    ...LEVELS.map((l) => ({ value: l as Level | 'class', label: t(`school.${LEVEL_SHORT[l]}`), aria: t(`school.${LEVEL_WORDS[l]}`) })),
  ];
  const lockedCount = Object.values(asg.locked).reduce((n, r) => n + r.length, 0);
  const valid = asg.title.trim().length > 0 && (base.kind === 'starter' || base.id !== '');

  return (
    <div className="asg-edit" data-testid="assignment-editor">
      <div className="asg__head">
        <div>
          <h2 className="teacher__h1">{initial.title ? t('school.staff_asgEditTitle') : t('school.staff_asgNewTitle')}</h2>
          <p className="teacher__lede">{t('school.staff_asgEditLede')}</p>
        </div>
      </div>
      <div className="asg-edit__grid">
        <section className="tpanel asg-edit__main">
          <Field label={t('school.staff_asgFieldTitle')} value={asg.title} maxLength={60} counter onChange={(e) => patch({ title: e.target.value })} placeholder={t('school.staff_asgTitleExample')} />
          <TextArea label={t('school.staff_asgFieldText')} hint={t('school.staff_asgFieldTextHint')} value={asg.text} maxLength={400} counter rows={3} onChange={(e) => patch({ text: e.target.value })} />
          <div className="asg-edit__pair">
            <div className="field">
              <label className="field__label" htmlFor={ids.base}>
                {t('school.staff_asgFieldStarter')}
              </label>
              <div className="tinput tinput--select">
                <select
                  id={ids.base}
                  className="tinput__field"
                  value={baseKey(base)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBase(v.startsWith('own:') ? { kind: 'own', id: v.slice(4) } : { kind: 'starter', id: v as StarterId });
                    patch({ require: [], goals: asg.goals.filter((g) => g.kind === 'teacher'), locked: {} });
                  }}
                >
                  <optgroup label={t('school.staff_asgStarters')}>
                    {starters.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title} · {s.genre}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={t('school.staff_asgOwnWorlds')}>
                    {ownWorlds.length === 0 && (
                      <option value="own:" disabled>
                        {t('school.staff_asgNoOwnWorlds')}
                      </option>
                    )}
                    {ownWorlds.map((w) => (
                      <option key={w.id} value={`own:${w.id}`}>
                        {w.title}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
            </div>
            <Field label={t('school.staff_asgFieldDue')} placeholder={t('school.staff_asgDueExample')} value={asg.due} maxLength={40} onChange={(e) => patch({ due: e.target.value })} />
          </div>
          {base.kind === 'own' && <p className="field__hint asg-edit__ownhint">{t('school.staff_asgOwnHint')}</p>}
          <div className="asg-edit__opts">
            <div className="asg-edit__row">
              <span className="field__label">{t('school.staff_asgAiTitle')}</span>
              <Segmented<AiMode>
                label={t('school.staff_asgAiTitle')}
                size={38}
                options={[
                  { value: 'on', label: t('school.staff_modeOn') },
                  { value: 'explain', label: t('school.staff_modeExplain') },
                  { value: 'off', label: t('school.staff_modeOff') },
                ]}
                value={asg.ai}
                onChange={(ai) => patch({ ai })}
              />
            </div>
            <div className="asg-edit__row">
              <span className="field__label">{t('school.staff_asgLevel')}</span>
              <CappedChoice label={t('school.staff_clLevel')} options={levelOptions} value={asg.level ?? 'class'} onChange={(v) => patch({ level: v === 'class' ? null : v })} locked={(v) => v !== 'class' && LEVELS.indexOf(v) > LEVELS.indexOf(levelMax)} />
            </div>
            <div className="asg-edit__row">
              <span className="field__label">{t('school.staff_asgLocked')}</span>
              <Button variant="ghost" size={38} icon="lock" onClick={() => setLocking(true)} disabled={code.length === 0}>
                {lockedCount ? t('school.staff_asgLockedCount', { n: lockedCount }) : t('school.staff_asgLockLines')}
              </Button>
            </div>
          </div>
        </section>

        <section className="tpanel asg-edit__side">
          <fieldset className="asg-edit__set">
            <legend className="tpanel__h">{t('school.staff_asgRequired')}</legend>
            {cast === null ? (
              <p className="field__hint">{t('school.staff_loading')}</p>
            ) : drawable.length === 0 ? (
              <p className="field__hint">{t('school.staff_asgNoCast')}</p>
            ) : (
              <div className="asg-edit__checks">
                {drawable.map((m) => (
                  <Check key={m.key} checked={asg.require.includes(m.key)} onChange={() => toggleRequired(m.key)}>
                    {m.name} <small>{roleWord(m.role)}</small>
                  </Check>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className="asg-edit__set">
            <legend className="tpanel__h">{t('school.staff_asgGoalsTitle')}</legend>
            <div className="asg-edit__checks">
              {AUTO_GOALS.filter((id) => autoGoalAvailable(id, members)).map((id) => (
                <Check key={id} checked={chosenGoals.has(id)} onChange={() => toggleGoal(id)}>
                  {autoGoalLabel(id)} <small>{t('school.staff_evAuto')}</small>
                </Check>
              ))}
            </div>
            {asg.goals.filter((g) => g.kind === 'teacher').length > 0 && (
              <ul className="asg-edit__own">
                {asg.goals
                  .filter((g) => g.kind === 'teacher')
                  .map((g) => (
                    <li key={g.id}>
                      <Icon name="teacher" size={16} />
                      <span>{g.label}</span>
                      <button type="button" className="locklines__remove" onClick={() => patch({ goals: asg.goals.filter((x) => x.id !== g.id) })}>
                        {t('school.staff_remove')}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            <div className="asg-edit__add">
              <Field label={t('school.staff_asgOwnGoal')} labelHidden placeholder={t('school.staff_asgOwnGoalExample')} value={newGoal} maxLength={120} onChange={(e) => setNewGoal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTeacherGoal()} />
              <Button variant="ghost" icon="plus" size={44} onClick={addTeacherGoal} disabled={!newGoal.trim()}>
                {t('school.staff_add')}
              </Button>
            </div>
          </fieldset>

        </section>
      </div>

      <div className="asg-edit__foot">
        <Button variant="quiet" onClick={() => onDone(false)}>
          {t('school.staff_cancel')}
        </Button>
        <span className="asg-edit__spacer" />
        {!valid && <p className="asg-edit__why">{asg.title.trim() ? t('school.staff_asgPickWorld') : t('school.staff_asgNeedTitle')}</p>}
        {base.kind === 'starter' && (
          <TButton
            variant="ghost"
            icon="link"
            disabled={!valid}
            onClick={() => {
              const next = saved();
              onDone(true);
              putInLink(next);
            }}
          >
            {t('school.staff_asgPutInLink')}
          </TButton>
        )}
        <TButton
          variant="ghost"
          icon="download"
          disabled={!valid}
          onClick={() => {
            const next = saved();
            void saveAssignmentFile(services, next, base.kind === 'own' ? base.id : null);
          }}
        >
          {t('school.staff_asgSaveFile')}
        </TButton>
        <Button
          variant="lantern"
          icon="check"
          disabled={!valid}
          onClick={() => {
            saved();
            onDone(true);
          }}
        >
          {t('school.staff_save')}
        </Button>
      </div>

      {locking && <LockLines code={code} locked={asg.locked} onChange={(locked) => patch({ locked })} onClose={() => setLocking(false)} />}
    </div>
  );
}

