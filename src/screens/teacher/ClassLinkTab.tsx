/**
 * Teacher desk → Class link (§2.14; spec-mocks/13-teacher-classlink.png). Left: the school's AI helper
 * (address locked when the district set it, class code tested live), the class (name, AI mode, content level
 * capped by the district, assignment, expiry) and "Ready for tomorrow?". Right: the paper card to post in
 * Classroom (QR made on this device, Copy link, Big), a live preview of the Join card, and the trust line.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from '../../app/Link';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import type { AiMode, ClassLinkV1, Level } from '../../model/types';
import { fitsInLink } from '../../school/assignment';
import { capLink, classLinkHref, DEFAULT_CLASS_HEADER, DEFAULT_MODEL, payloadFits, shortHref } from '../../school/classLink';
import { qrScannable } from '../../school/qr';
import { setReadyTick, updateTeacherData, useReadyTicks, useTeacherData, type ReadyItem } from '../../school/teacherData';
import { formatSeconds, hostOf, testEndpoint, type TestResult } from '../../school/testConnection';
import { showToast } from '../../state/app';
import { LEVELS } from '../../state/config';
import { useStore } from '../../state/store';
import { Dialog, PaperCard } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { JoinCardBody } from '../join/JoinCard';
import { QrCode } from './QrCode';
import { blankLink } from './actions';
import { CappedChoice } from './CappedChoice';
import { SchoolIcon } from './SchoolIcon';
import { TButton } from './TButton';

const CAPS = ['json_schema', 'stream', 'reasoning', 'vision', 'moderation'] as const;

export const LEVEL_WORDS: Record<Level, 'staff_levelElementary' | 'staff_levelMiddle' | 'staff_levelHigh'> = {
  elementary: 'staff_levelElementary',
  middle: 'staff_levelMiddle',
  high: 'staff_levelHigh',
};

const MODE_WORDS: Record<AiMode, 'staff_modeOn' | 'staff_modeExplain' | 'staff_modeOff'> = { on: 'staff_modeOn', explain: 'staff_modeExplain', off: 'staff_modeOff' };

function validAddress(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
  } catch {
    return false;
  }
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
}

function ReadyRow({ item, done, children, action }: { item: ReadyItem; done: number | undefined; children: ReactNode; action: ReactNode }) {
  const time = done ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(done) : null;
  return (
    <li className={cx('ready__row', done ? 'ready__row--done' : null)}>
      <button type="button" role="checkbox" aria-checked={Boolean(done)} className="ready__box" onClick={() => setReadyTick(item, !done)}>
        {done ? <Icon name="check" size={16} /> : null}
        <span className="sr-only">{t('school.staff_readyTick')}</span>
      </button>
      <span className="ready__words">{children}</span>
      <span className="ready__action">{time ? t('school.staff_readyDone', { time }) : action}</span>
    </li>
  );
}

export function ClassLinkTab() {
  const { store } = useServices();
  const teacher = useTeacherData();
  const ticks = useReadyTicks();
  const ai = useStore((s) => s.config.ai);
  const levelMax = useStore((s) => s.config.levelMax);
  const draft = teacher.link ?? blankLink();
  const ids = { ai: useId(), cls: useId(), code: useId(), addr: useId(), name: useId(), exp: useId(), asg: useId(), model: useId() };

  // The district's endpoint (a build or managed config) is locked; a class link can't change it.
  const districtEndpoint = ai && (ai.source === 'managed' || ai.source === 'build') && ai.baseUrl ? ai : null;
  const districtName = ai?.district?.name ?? null;
  const districtAiOff = Boolean(ai && ai.offReason === 'turned-off' && (ai.offBy === 'managed' || ai.offBy === 'build'));
  const address = districtEndpoint?.baseUrl ?? draft.ai?.baseUrl ?? '';
  const code = draft.ai?.auth.type === 'class-code' ? draft.ai.auth.code : '';
  const model = districtEndpoint?.model || draft.ai?.model || DEFAULT_MODEL;
  const caps = draft.ai?.caps ?? '';
  const [addressText, setAddressText] = useState(address);
  const [test, setTest] = useState<{ state: 'idle' | 'testing' } | { state: 'done'; result: TestResult }>({ state: 'idle' });
  const [big, setBig] = useState(false);
  const linkBox = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (districtEndpoint) setAddressText(districtEndpoint.baseUrl);
  }, [districtEndpoint]);

  const save = (patch: Partial<ClassLinkV1>, aiPatch?: { baseUrl?: string; code?: string; model?: string; caps?: string }) => {
    updateTeacherData((d) => {
      const cur = d.link ?? blankLink();
      const next: ClassLinkV1 = { ...cur, ...patch, district: districtName ?? cur.district };
      if (aiPatch) {
        const baseUrl = aiPatch.baseUrl ?? cur.ai?.baseUrl ?? districtEndpoint?.baseUrl ?? '';
        const codeNow = aiPatch.code ?? (cur.ai?.auth.type === 'class-code' ? cur.ai.auth.code : '');
        const modelNow = aiPatch.model ?? cur.ai?.model ?? DEFAULT_MODEL;
        const capsNow = aiPatch.caps ?? cur.ai?.caps;
        next.ai = baseUrl
          ? {
              baseUrl,
              model: modelNow || DEFAULT_MODEL,
              ...(capsNow ? { caps: capsNow } : {}),
              auth: codeNow ? { type: 'class-code', header: DEFAULT_CLASS_HEADER, code: codeNow } : { type: 'none' },
            }
          : null;
      }
      return { ...d, link: next };
    });
  };

  // The link students get: the district's address and model when it set them, capped to its ceiling.
  const link: ClassLinkV1 = useMemo(() => {
    const aiPart = address && validAddress(address) ? { baseUrl: address.replace(/\/+$/, ''), model, ...(caps && !districtEndpoint ? { caps } : {}), auth: code ? ({ type: 'class-code', header: DEFAULT_CLASS_HEADER, code } as const) : ({ type: 'none' } as const) } : null;
    const asg = draft.asg ? (teacher.assignments.find((a) => a.id === draft.asg?.id) ?? draft.asg) : null;
    return capLink({ ...draft, district: districtName ?? draft.district, ai: aiPart, asg }, { levelMax, aiAllowed: !districtAiOff });
  }, [address, model, caps, code, draft, teacher.assignments, districtName, levelMax, districtAiOff, districtEndpoint]);

  const nameMissing = !link.cls.trim();
  const addressBad = addressText.trim() !== '' && !validAddress(addressText.trim());
  const fits = payloadFits(link);
  let href = '';
  try {
    href = classLinkHref(link);
  } catch {
    href = '';
  }
  const ready = !nameMissing && !addressBad && fits && href !== '';
  const scannable = ready && qrScannable(href);

  // The live test: when the address or the class code changes (after a pause in typing).
  useEffect(() => {
    if (!address || !validAddress(address) || !code.trim()) {
      setTest({ state: 'idle' });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setTest({ state: 'testing' });
      void testEndpoint({ baseUrl: address, model, auth: { type: 'class-code', header: DEFAULT_CLASS_HEADER, code } }, { signal: controller.signal, store }).then((result) => {
        if (!controller.signal.aborted) setTest({ state: 'done', result });
      });
    }, 700);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [address, code, model, store]);

  const copy = async () => {
    if (!ready) return;
    try {
      await navigator.clipboard.writeText(href);
      showToast(t('school.staff_linkCopied'), { kind: 'success' });
    } catch {
      const range = document.createRange();
      if (linkBox.current) {
        range.selectNodeContents(linkBox.current);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
      }
      showToast(t('school.staff_linkCopyByHand'));
    }
  };

  const testStatus =
    test.state === 'testing' ? (
      <span className="cl-status cl-status--testing">{t('school.staff_testing')}</span>
    ) : test.state === 'done' ? (
      test.result.ok ? (
        <span className="cl-status cl-status--ok">
          <Icon name="check" size={16} />
          {t('school.staff_testWorks', { time: formatSeconds(test.result.ms) })}
        </span>
      ) : (
        <span className="cl-status cl-status--bad">
          <Icon name="warning" size={16} />
          {t('school.staff_testFailedShort')}
        </span>
      )
    ) : null;

  const levels = LEVELS.map((l) => ({ value: l, label: t(`school.${LEVEL_WORDS[l]}`) }));
  const modes = (['on', 'explain', 'off'] as const).map((m) => ({ value: m, label: t(`school.${MODE_WORDS[m]}`) }));
  const linkAssignments = teacher.assignments.filter(fitsInLink);
  const appHost = typeof location === 'undefined' ? '' : location.host;
  const aiHost = address ? hostOf(address) : null;

  return (
    <div className="cl" data-testid="teacher-classlink">
      <section className="cl__form" aria-labelledby={`${ids.cls}-h`}>
        <h2 id={`${ids.cls}-h`} className="teacher__h1">
          {t('school.staff_clTitle')}
        </h2>
        <p className="teacher__lede">{t('school.staff_clLede')}</p>

        <section className="tpanel" aria-labelledby={`${ids.ai}-h`}>
          <h3 id={`${ids.ai}-h`} className="tpanel__h">
            <Icon name="sparkle" size={20} className="icon--ai" />
            {t('school.staff_clAiTitle')}
            <small>{t('school.staff_clAiFrom')}</small>
          </h3>
          <div className="trow">
            <label className="trow__label" htmlFor={ids.addr}>
              {t('school.staff_clAddress')}
            </label>
            <div className={cx('tinput', addressBad && 'tinput--bad', districtEndpoint && 'tinput--locked')}>
              <input
                id={ids.addr}
                className="tinput__field tinput__field--mono"
                value={addressText}
                readOnly={Boolean(districtEndpoint)}
                placeholder="https://amble-ai.your-district.org/v1"
                spellCheck={false}
                autoComplete="off"
                inputMode="url"
                aria-describedby={`${ids.addr}-s`}
                onChange={(e) => {
                  setAddressText(e.target.value);
                  const v = e.target.value.trim();
                  if (v === '' || validAddress(v)) save({}, { baseUrl: v.replace(/\/+$/, '') });
                }}
              />
              <span id={`${ids.addr}-s`} className="tinput__suffix">
                {districtEndpoint ? (
                  <span className="cl-status cl-status--ok">
                    <Icon name="lock" size={14} />
                    {districtName ? t('school.staff_setBy', { district: districtName }) : t('school.staff_setBySchool')}
                  </span>
                ) : addressBad ? (
                  <span className="cl-status cl-status--bad">{t('school.staff_addressHttps')}</span>
                ) : null}
              </span>
            </div>
          </div>
          <div className="trow">
            <label className="trow__label" htmlFor={ids.code}>
              {t('school.staff_clCode')}
              <small>{t('school.staff_clCodeHint')}</small>
            </label>
            <div className={cx('tinput', test.state === 'done' && !test.result.ok && 'tinput--bad')}>
              <input
                id={ids.code}
                className="tinput__field tinput__field--mono"
                value={code}
                maxLength={80}
                spellCheck={false}
                autoComplete="off"
                disabled={!address}
                aria-describedby={`${ids.code}-s`}
                onChange={(e) => save({}, { code: e.target.value.trim() })}
              />
              <span id={`${ids.code}-s`} className="tinput__suffix" aria-live="polite">
                {testStatus}
              </span>
            </div>
          </div>
          {test.state === 'done' && !test.result.ok && (
            <p className="cl__problem" role="alert">
              {test.result.message}
            </p>
          )}
          {!address && (
            <p className="cl__note">
              {t('school.staff_noDistrictAi')}{' '}
              <Link to={{ name: 'page', page: 'it' }}>{t('school.staff_itPageLink')}</Link>
            </p>
          )}
          {!districtEndpoint && address && (
            <details className="cl__more">
              <summary>{t('school.staff_clAdvanced')}</summary>
              <div className="trow">
                <label className="trow__label" htmlFor={ids.model}>
                  {t('school.staff_clModel')}
                  <small>{t('school.staff_clModelHint')}</small>
                </label>
                <div className="tinput">
                  <input id={ids.model} className="tinput__field tinput__field--mono" value={draft.ai?.model ?? DEFAULT_MODEL} maxLength={80} spellCheck={false} onChange={(e) => save({}, { model: e.target.value.trim() })} />
                </div>
              </div>
              <fieldset className="cl__caps">
                <legend className="trow__label">{t('school.staff_clCaps')}</legend>
                {CAPS.map((c) => {
                  const on = caps.split(',').includes(c);
                  return (
                    <label key={c} className="cl__cap">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          const set = new Set(caps.split(',').filter(Boolean));
                          if (on) set.delete(c);
                          else set.add(c);
                          save({}, { caps: CAPS.filter((x) => set.has(x)).join(',') });
                        }}
                      />
                      <code>{c}</code>
                    </label>
                  );
                })}
              </fieldset>
            </details>
          )}
        </section>

        <section className="tpanel" aria-labelledby={`${ids.name}-h`}>
          <h3 id={`${ids.name}-h`} className="tpanel__h">
            <SchoolIcon name="clipboard" />
            {t('school.staff_clClassTitle')}
          </h3>
          <div className="trow">
            <label className="trow__label" htmlFor={ids.name}>
              {t('school.staff_clName')}
            </label>
            <div className="tinput">
              <input id={ids.name} className="tinput__field" value={draft.cls} maxLength={40} placeholder={t('school.staff_classNameExample')} autoComplete="off" onChange={(e) => save({ cls: e.target.value })} />
            </div>
          </div>
          <div className="trow">
            <span className="trow__label" id={`${ids.ai}-mode`}>
              {t('school.staff_clAiMode')}
              {districtAiOff && <small>{t('school.staff_districtAiOff', { district: districtName ?? t('school.staff_yourDistrict') })}</small>}
            </span>
            <CappedChoice label={t('school.staff_clAiMode')} options={modes} value={link.mode} onChange={(mode) => save({ mode })} locked={(m) => districtAiOff && m !== 'off'} />
          </div>
          <div className="trow">
            <span className="trow__label">
              {t('school.staff_clLevel')}
              {levelMax !== 'high' && <small>{t('school.staff_levelCap', { district: districtName ?? t('school.staff_yourDistrict'), level: t(`school.${LEVEL_WORDS[levelMax]}`) })}</small>}
            </span>
            <CappedChoice label={t('school.staff_clLevel')} options={levels} value={link.level} onChange={(level) => save({ level })} locked={(l) => LEVELS.indexOf(l) > LEVELS.indexOf(levelMax)} />
          </div>
          <div className="trow">
            <label className="trow__label" htmlFor={ids.asg}>
              {t('school.staff_clAssignment')}
            </label>
            <div className="tinput tinput--select">
              <select
                id={ids.asg}
                className="tinput__field"
                value={draft.asg?.id ?? ''}
                onChange={(e) => {
                  const asg = teacher.assignments.find((a) => a.id === e.target.value) ?? null;
                  save({ asg });
                }}
              >
                <option value="">{t('school.staff_clNoAssignment')}</option>
                {linkAssignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title || t('school.staff_asgUntitled')}
                  </option>
                ))}
              </select>
              <span className="tinput__suffix tinput__suffix--quiet">{draft.asg ? t('school.staff_clAsgShows') : <Link to={{ name: 'teacher', tab: 'assignments' }}>{t('school.staff_clMakeAssignment')}</Link>}</span>
            </div>
          </div>
          <div className="trow">
            <label className="trow__label" htmlFor={ids.exp}>
              {t('school.staff_clUntil')}
            </label>
            <div className="tinput tinput--date">
              <input id={ids.exp} type="date" className="tinput__field" value={draft.exp ?? ''} onChange={(e) => save({ exp: e.target.value || null })} />
            </div>
          </div>
        </section>

        <section className="tpanel ready" aria-labelledby={`${ids.exp}-ready`}>
          <h3 id={`${ids.exp}-ready`} className="tpanel__h">
            <Icon name="check" size={20} />
            {t('school.staff_readyTitle')}
            <small>{t('school.staff_readyTime')}</small>
          </h3>
          <ul className="ready__list">
            <ReadyRow item="test" done={ticks.test} action={null}>
              {t('school.staff_readyTest')}
            </ReadyRow>
            <ReadyRow item="it" done={ticks.it} action={<Link to={{ name: 'page', page: 'it' }}>{t('school.staff_itPageShort')}</Link>}>
              {t('school.staff_readyItBefore')} <b className="mono">{appHost}</b>
              {aiHost && (
                <>
                  {' '}
                  {t('school.staff_readyAnd')} <b className="mono">{aiHost}</b>
                </>
              )}
            </ReadyRow>
            <ReadyRow item="poster" done={ticks.poster} action={<Link to={{ name: 'page', page: 'poster' }}>{t('school.staff_print')}</Link>}>
              {t('school.staff_readyPoster')}
            </ReadyRow>
            <ReadyRow item="letter" done={ticks.letter} action={<Link to={{ name: 'page', page: 'parents' }}>{t('school.staff_letter')}</Link>}>
              {t('school.staff_readyLetter')}
            </ReadyRow>
          </ul>
        </section>
      </section>

      <aside className="cl__out" aria-label={t('school.staff_clOutLabel')}>
        <PaperCard tape="lemon" tilt={0} className="linkcard">
          <p className="linkcard__k">{t('school.staff_postThis')}</p>
          <p className="linkcard__cls">{link.cls || t('school.staff_classNameExample')}</p>
          {ready ? (
            <div className="linkcard__row">
              <div className="linkcard__qr">{scannable ? <QrCode text={href} label={t('school.staff_qrLabel', { cls: link.cls })} /> : <p className="linkcard__long">{t('school.staff_qrTooLong')}</p>}</div>
              <div className="linkcard__col">
                <p ref={linkBox} className="linkcard__url mono" title={href}>
                  {shortHref(href, 48)}
                </p>
                <div className="linkcard__btns">
                  <TButton variant="lantern" icon="copy" onClick={() => void copy()} testId="copy-link">
                    {t('school.staff_copyLink')}
                  </TButton>
                  <TButton variant="paper" icon="present" onClick={() => setBig(true)} disabled={!scannable}>
                    {t('school.staff_big')}
                  </TButton>
                </div>
              </div>
            </div>
          ) : (
            <p className="linkcard__wait">{nameMissing ? t('school.staff_needName') : addressBad ? t('school.staff_addressHttps') : t('school.staff_linkTooLong')}</p>
          )}
          <p className="linkcard__exp">
            <SchoolIcon name="clock" size={16} />
            {link.exp ? t('school.staff_worksUntil', { date: formatDay(link.exp) }) : t('school.staff_worksAlways')}
          </p>
        </PaperCard>

        <section className="tpanel preview" aria-labelledby={`${ids.cls}-see`}>
          <h3 id={`${ids.cls}-see`} className="tcaps">
            {t('school.staff_whatStudentsSee')}
          </h3>
          <JoinCardBody link={link} />
        </section>

        <p className="cl__trust">
          <SchoolIcon name="shield" />
          <span>{t('school.staff_trust')}</span>
        </p>
      </aside>

      {big && ready && (
        <Dialog open title={link.cls} titleHidden onClose={() => setBig(false)} className="qr-big" dismissOnBackdrop>
          <div className="qr-big__inner on-paper">
            <p className="qr-big__cls">{link.cls}</p>
            <QrCode text={href} label={t('school.staff_qrLabel', { cls: link.cls })} className="qr-big__code" />
            <p className="qr-big__hint">{t('school.staff_bigHint')}</p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
