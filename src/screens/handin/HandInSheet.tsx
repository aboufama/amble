/**
 * `#/w/<id>/handin` Hand in (§2.13; spec-mocks/12-handin.png): a sheet over the running world. The
 * checklist with evidence on the left; step 1 Save to your Drive (initials, not names) and step 2 the four
 * Classroom steps on the right; the honesty line; Back to my world and I turned it in. A failing checklist
 * never blocks.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useCommand } from '../../app/keys';
import { navigate } from '../../app/router';
import type { RouteOf } from '../../app/routes';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { tn } from '../../school/count';
import type { World } from '../../model/types';
import { artFactsOf, checkWorld, cleanInitials, commitWorld, loadWorld, robotRun, storyOf, suggestedFileName, withAmbleExtension, type HandinCheck } from '../../school/handin';
import { runChecks, goalsFor } from '../../school/checks';
import { codeFacts } from '../../school/codeFacts';
import type { Story } from '../../school/story';
import { announce, showToast } from '../../state/app';
import { markSeen } from '../../state/prefs';
import { useStore } from '../../state/store';
import { Button, Dialog, Field } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { Checklist } from './Checklist';
import { ClassroomSteps } from './ClassroomSteps';
import './handin.css';

const time = (at: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at);

function hasSavePicker(): boolean {
  return typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

function useWorld(id: string): [World | null, (w: World) => void, boolean] {
  const open = useStore((s) => (s.session.world?.id === id ? s.session.world : null));
  const [stored, setStored] = useState<World | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (open) return;
    let live = true;
    void loadWorld(id).then((w) => {
      if (!live) return;
      setStored(w);
      setMissing(!w);
    });
    return () => {
      live = false;
    };
  }, [id, open]);
  return [open ?? stored, setStored, missing];
}

function useSnapshot(world: World | null): string | null {
  const { store } = useServices();
  const [url, setUrl] = useState<string | null>(null);
  const id = world?.id;
  useEffect(() => {
    if (!id) return;
    let live = true;
    void store.worlds
      .list()
      .then((metas) => metas.find((m) => m.id === id)?.snapshot ?? null)
      .then((ref) => (ref ? store.blobs.url(ref) : null))
      .then((u) => live && setUrl(u))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id, store]);
  return url;
}

export function HandInSheet({ route }: { route: RouteOf<'handin'> }) {
  const services = useServices();
  const [world, setWorld, missing] = useWorld(route.worldId);
  const manifest = useStore((s) => (s.session.world?.id === route.worldId ? s.session.manifest : null));
  const cls = useStore((s) => s.config.classLink?.cls ?? null);
  const firstInitials = useStore((s) => !s.prefs.seen.handinInitials);
  const [check, setCheck] = useState<HandinCheck | null>(null);
  const [testing, setTesting] = useState(false);
  const [story, setStory] = useState<Story | null>(null);
  const [initials, setInitials] = useState('');
  const [fileName, setFileName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [turning, setTurning] = useState(false);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const [nudge, setNudge] = useState(false);
  const saveRef = useRef<HTMLButtonElement>(null);
  const snapshot = useSnapshot(world);
  const headingId = useId();
  const stepsId = useId();
  const loadedFor = useRef<string | null>(null);

  const close = () => navigate({ name: 'world', id: route.worldId });

  // Fill the fields once per world; the honesty line follows the world's Footsteps.
  useEffect(() => {
    if (!world || loadedFor.current === world.id) return;
    loadedFor.current = world.id;
    setInitials(world.credits.madeBy);
    setFileName(world.handIn.fileName ?? suggestedFileName(world, world.credits.madeBy));
  }, [world]);
  const steps0 = world?.steps ?? null;
  useEffect(() => {
    if (!world) return;
    let live = true;
    void storyOf(world).then((s) => live && setStory(s));
    return () => {
      live = false;
    };
  }, [steps0]);

  const runTest = useCallback(
    async (w: World, base: HandinCheck) => {
      setTesting(true);
      const robot = await robotRun(w);
      const goals = goalsFor(w, base.cast);
      const art = await artFactsOf(w);
      setCheck({ cast: base.cast, outcomes: runChecks(goals, { world: w, cast: base.cast, art: (id) => art.get(id) ?? null, facts: codeFacts(w.code), robot }) });
      setTesting(false);
      announce(robot && robot.errors === 0 ? t('school.testedAnnounce') : t('school.testedProblems'));
    },
    [],
  );

  // Check once the world is here (and again if its code or assignment changes): the quick checks at
  // once, then the robot test. Saving (initials, the file) doesn't re-run them.
  const worldId = world?.id ?? null;
  const assignment0 = world?.assignment ?? null;
  const code0 = world?.code ?? null;
  useEffect(() => {
    if (!worldId) return;
    const w = world;
    if (!w) return;
    let live = true;
    void checkWorld(w, manifest, { robot: false }).then((base) => {
      if (!live) return;
      setCheck(base);
      if (base.outcomes.some((o) => o.goal.kind === 'auto' && o.goal.check.type === 'runs-clean')) void runTest(w, base);
    });
    return () => {
      live = false;
    };
  }, [worldId, assignment0, code0]);

  // Ctrl+S here is step 1: the file with the initials, not the world's plain save behind the sheet.
  const saveNow = useRef<() => void>(() => undefined);
  useCommand('save', () => {
    saveNow.current();
  });

  if (missing) {
    return (
      <Dialog open size="sm" title={t('school.handinTitle')} onClose={close} className="handin" actions={<Button variant="lantern" onClick={() => navigate({ name: 'trail', view: 'trail' })}>{t('school.handinMissingBack')}</Button>}>
        <div data-testid="screen-handin">
          <p className="dialog__text">{t('school.handinMissing')}</p>
        </div>
      </Dialog>
    );
  }

  const outcomes = check?.outcomes ?? null;
  const allPass = outcomes !== null && !testing && outcomes.every((o) => o.pass !== false);
  const saved = world?.handIn.savedAt ? world.handIn : null;
  const turnedIn = world?.handIn.turnedInAt ?? null;
  const picker = hasSavePicker();
  const assignment = world?.assignment?.title ?? null;
  const subtitle = [assignment, cls].filter(Boolean).join(' · ');

  const onInitials = (v: string) => {
    const clean = cleanInitials(v);
    setInitials(v.slice(0, 20));
    if (world && !nameEdited) setFileName(suggestedFileName(world, clean));
  };

  const save = async () => {
    if (!world || saving) return;
    setSaving(true);
    setSaveProblem(null);
    const madeBy = cleanInitials(initials);
    const name = withAmbleExtension(fileName.trim() || suggestedFileName(world, madeBy));
    const withCredits: World = { ...world, credits: { madeBy } };
    try {
      const result = await services.files.saveWorld(withCredits, { name });
      if (!result) {
        setSaving(false);
        return;
      }
      const next: World = { ...withCredits, handIn: { ...withCredits.handIn, fileName: result.name, savedAt: result.at, method: result.method } };
      setWorld(await commitWorld(next));
      setFileName(result.name);
      if (firstInitials) markSeen('handinInitials');
      setNudge(false);
      const said = result.method === 'fs-access' ? t('school.savedDrive', { time: time(result.at) }) : t('school.savedDownload', { time: time(result.at) });
      announce(said);
    } catch (err) {
      const message = err instanceof Error && err.name === 'FileProblem' ? err.message : t('school.saveFailed');
      setSaveProblem(message);
      announce(message, 'assertive');
    } finally {
      setSaving(false);
    }
  };

  saveNow.current = () => void save();

  const turnIn = async () => {
    if (!world || turning) return;
    if (!saved) {
      setNudge(true);
      saveRef.current?.focus();
      return;
    }
    setTurning(true);
    try {
      const at = Date.now();
      const recorded = await services.history.record(world, { kind: 'handin', by: 'student', text: t('school.stepHandedIn', { name: saved.fileName ?? fileName }) });
      const next: World = { ...recorded, handIn: { ...recorded.handIn, turnedInAt: at } };
      setWorld(await commitWorld(next));
      const said = t('school.handedIn', { time: time(at) });
      showToast(said, { kind: 'success' });
      announce(said);
      close();
    } catch (err) {
      console.warn('Turning it in was not recorded:', err);
      showToast(t('school.turnInFailed'), { kind: 'error' });
    } finally {
      setTurning(false);
    }
  };

  const title = (
    <>
      <span id={headingId}>{t('school.handinTitle')}</span>
      {subtitle && <span className="handin__sub">{subtitle}</span>}
    </>
  );

  return (
    <Dialog
      open
      title={title}
      onClose={close}
      className="handin"
      actions={
        <>
          <p className="handin__keep">{t('school.keepWorking')}</p>
          <Button variant="ghost" onClick={close}>
            {t('school.backToWorld')}
          </Button>
          <Button variant="lantern" icon={turnedIn ? 'check' : undefined} busy={turning} onClick={() => void turnIn()} data-testid="turned-in">
            {turnedIn ? t('school.turnedInAgain', { time: time(turnedIn) }) : t('school.turnedIn')}
          </Button>
        </>
      }
    >
      <div className="handin__grid" data-testid="screen-handin">
        <section className="handin__checklist" aria-labelledby={`${headingId}-list`}>
          <h3 id={`${headingId}-list`} className="handin__h">
            <Icon name="check" size={20} />
            {t('school.yourChecklist')}
          </h3>
          {world && <Checklist worldId={world.id} cast={check?.cast ?? []} outcomes={outcomes} testing={testing} onRetest={() => check && void runTest(world, check)} />}
          {outcomes && !testing && (
            <p className={cx('handin__verdict', allPass ? 'handin__verdict--pass' : 'handin__verdict--open')}>
              <Icon name={allPass ? 'star' : 'info'} size={20} />
              {allPass ? t('school.allSet') : t('school.canHandIn')}
            </p>
          )}
          {snapshot && (
            <figure className="handin__snapshot">
              <img src={snapshot} alt={t('school.snapshotAlt', { title: world?.title ?? '' })} />
            </figure>
          )}
        </section>

        <div className="handin__steps" aria-labelledby={stepsId}>
          <h3 id={stepsId} className="sr-only">
            {t('school.stepsHeading')}
          </h3>
          <section className={cx('handin-step', saved ? 'handin-step--done' : 'handin-step--now')}>
            <span className="handin-step__n" aria-hidden="true">
              {saved ? <Icon name="check" size={22} /> : '1'}
            </span>
            <div className="handin-step__body">
              <h4 className="handin-step__title">{t('school.step1')}</h4>
              {!world?.credits.madeBy && firstInitials && !saved && <p className="handin-step__hint">{t('school.initialsHint')}</p>}
              {!saved && (
                <div className="handin-step__fields">
                  <Field label={t('school.initialsLabel')} value={initials} maxLength={20} autoComplete="off" spellCheck={false} onChange={(e) => onInitials(e.target.value)} className="handin-step__initials" />
                  <Field
                    label={t('school.fileNameLabel')}
                    value={fileName}
                    maxLength={120}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => {
                      setFileName(e.target.value);
                      setNameEdited(true);
                    }}
                    className="handin-step__name"
                  />
                </div>
              )}
              {saved && (
                <div className="handin-file">
                  <span className="handin-file__icon" aria-hidden="true">
                    <Icon name={saved.method === 'download' ? 'fileSave' : 'drive'} size={22} />
                  </span>
                  <span className="handin-file__words">
                    <span className="handin-file__name">{saved.fileName}</span>
                    <span className="handin-file__where">{saved.method === 'download' ? t('school.whereDownloads') : t('school.whereDrive')}</span>
                  </span>
                  <span className="handin-file__time">
                    <Icon name="check" size={16} />
                    {time(saved.savedAt ?? Date.now())}
                  </span>
                </div>
              )}
              {saved && <p className="handin-step__status" role="status">{saved.method === 'download' ? t('school.savedDownload', { time: time(saved.savedAt ?? 0) }) : t('school.savedDrive', { time: time(saved.savedAt ?? 0) })}</p>}
              {(saved?.method === 'download' || (!saved && !picker)) && <p className="handin-step__hint">{t('school.downloadHint')}</p>}
              {saveProblem && (
                <p className="handin-step__problem" role="alert">
                  {saveProblem}
                </p>
              )}
              {nudge && !saved && <p className="handin-step__problem">{t('school.saveFirst')}</p>}
              <div className="handin-step__actions">
                <Button ref={saveRef} variant={saved ? 'ghost' : 'lantern'} size={saved ? 38 : 44} icon={picker ? 'drive' : 'fileSave'} busy={saving} onClick={() => void save()} data-testid="save-drive">
                  {saved ? t('school.saveAgain') : picker ? t('school.saveToDrive') : t('school.downloadFile')}
                </Button>
              </div>
            </div>
          </section>

          <section className={cx('handin-step', turnedIn ? 'handin-step--done' : saved ? 'handin-step--now' : 'handin-step--later')}>
            <span className="handin-step__n" aria-hidden="true">
              {turnedIn ? <Icon name="check" size={22} /> : '2'}
            </span>
            <div className="handin-step__body">
              <h4 className="handin-step__title">{t('school.step2')}</h4>
              <ClassroomSteps assignment={assignment} />
              <p className="handin-step__hint">{t('school.cantSeeClassroom')}</p>
            </div>
          </section>

          <p className="handin__honesty">
            <Icon name="eye" size={20} />
            <span>{story ? t('school.honesty', { drawings: tn('school.countDrawings', story.drawings), ai: tn('school.countAi', story.aiChanges), code: tn('school.countCode', story.codeEdits) }) : t('school.honestyShort')}</span>
          </p>
        </div>
      </div>
    </Dialog>
  );
}
