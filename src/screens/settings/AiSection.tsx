/**
 * Settings → AI helper (§2.15, §5.14): what the helper is doing and who set it up, the class this
 * Chromebook joined (and Leave this class), What Amble sends, and, in the public build with nothing set by
 * a school, the grown-ups' manual setup (address, key, models, Test connection, Remember on this Chromebook).
 * A build that sets the address and asks for the user's own key (`VITE_AMBLE_AI_AUTH=user-key`) gets the key
 * field alone, for that address.
 */
import { useId, useState } from 'react';
import { Link } from '../../app/Link';
import { useServices } from '../../app/services';
import { clearAiSettings, loadAiSettings, OPENAI_BASE_URL, saveAiSettings, type AiConfig, type AiSettings } from '../../cores/ai';
import { t } from '../../i18n';
import { formatSeconds, hostOf, testEndpoint, type TestResult } from '../../school/testConnection';
import { announce, showToast } from '../../state/app';
import { refreshConfig } from '../../state/config';
import { useStore } from '../../state/store';
import { Button, Field, Toggle } from '../../ui/components';
import { confirmUser } from '../../ui/dialogs';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { SchoolIcon } from '../teacher/SchoolIcon';
import { Group } from './parts';

const LEVEL_WORDS = { elementary: 'school.levelElementary', middle: 'school.levelMiddle', high: 'school.levelHigh' } as const;

function stores() {
  const get = (name: 'localStorage' | 'sessionStorage') => {
    try {
      return globalThis[name] ?? null;
    } catch {
      return null;
    }
  };
  return { local: get('localStorage'), session: get('sessionStorage') };
}

/**
 * What Settings offers for setting up the AI: the key field alone (a build that set the address and asks for
 * the user's own key), the whole manual setup (the public build, when no school source provides or locks the
 * AI), or nothing.
 */
export function setupOffered(ai: AiConfig | null, schoolBuild: boolean): 'key' | 'manual' | null {
  if (!ai) return null;
  if (ai.userKeyFor) return 'key';
  return !schoolBuild && ai.manualAllowed && !ai.locked.includes('ai') ? 'manual' : null;
}

/** Why the AI helper is off, in the status line's words. */
export function offWords(ai: AiConfig): string {
  switch (ai.offReason) {
    case 'turned-off':
      return ai.offBy === 'manual' ? t('school.setOffYou') : ai.offBy === 'class-link' ? t('school.setOffTeacher') : t('school.setOffSchool');
    case 'expired':
      return t('school.setOffExpired');
    case 'grade-band':
      return t('school.setOffGrade');
    case 'needs-class-link':
      return t('school.setOffNeedsLink');
    case 'needs-key':
      return ai.userKeyFor ? t('school.setOffNeedsKey') : t('school.setOffKeySchool');
    default:
      return t('school.setOffNone');
  }
}

/** The key field with Show/Hide and the shared-Chromebook warning. */
function KeyField({ value, onChange }: { value: string; onChange(key: string): void }) {
  const [show, setShow] = useState(false);
  const keyId = useId();
  return (
    <>
      <div className="set-key">
        <Field
          id={keyId}
          label={t('school.setKey')}
          type={show ? 'text' : 'password'}
          value={value}
          spellCheck={false}
          autoComplete="off"
          aria-describedby={`${keyId}-warn`}
          onChange={(e) => onChange(e.target.value.trim())}
        />
        <Button variant="quiet" size={38} icon={show ? 'eyeOff' : 'eye'} onClick={() => setShow((v) => !v)} aria-controls={keyId} aria-pressed={show}>
          {show ? t('school.setHideKey') : t('school.setShowKey')}
        </Button>
      </div>
      <p className="set-warn" id={`${keyId}-warn`}>
        <Icon name="warning" size={16} />
        {t('school.setKeyWarning')}
      </p>
    </>
  );
}

function TestLine({ result }: { result: TestResult | null }) {
  if (!result) return null;
  return (
    <p className={cx('set-test', result.ok ? 'set-test--ok' : 'set-test--bad')} role="status">
      <Icon name={result.ok ? 'check' : 'warning'} size={16} />
      {result.ok ? t('school.setTestOk', { time: formatSeconds(result.ms) }) : result.message}
    </p>
  );
}

/**
 * A build that set the address and asks for the user's own key (`VITE_AMBLE_AI_AUTH=user-key`): the key field
 * alone. The key is saved with that address, and the AI core sends it to that address only.
 */
export function KeySetup({ address, model }: { address: string; model: string }) {
  const { store } = useServices();
  const saved = () => {
    const s = loadAiSettings(stores());
    return s.baseUrl === address ? s.apiKey : '';
  };
  const [key, setKey] = useState(saved);
  const [remember, setRemember] = useState(() => loadAiSettings(stores()).rememberKey);
  const [test, setTest] = useState<{ busy: boolean; result: TestResult | null }>({ busy: false, result: null });
  const [stored, setStored] = useState(() => saved() !== '');

  const save = async () => {
    saveAiSettings({ ...loadAiSettings(stores()), baseUrl: address, apiKey: key, rememberKey: remember }, stores());
    setStored(key !== '');
    await refreshConfig();
    showToast(t('school.setManualSaved'), { kind: 'success' });
  };

  const forget = async () => {
    saveAiSettings({ ...loadAiSettings(stores()), baseUrl: '', apiKey: '' }, stores());
    setKey('');
    setStored(false);
    await refreshConfig();
    showToast(t('school.setKeyForgot'));
  };

  const runTest = async () => {
    setTest({ busy: true, result: null });
    const result = await testEndpoint({ baseUrl: address, model, auth: key ? { type: 'bearer', key } : { type: 'none' } }, { store });
    setTest({ busy: false, result });
    announce(result.ok ? t('school.setTestOk', { time: formatSeconds(result.ms) }) : result.message);
  };

  return (
    <div className="set-manual__body" data-testid="ai-key-setup">
      <p className="set-row__hint">{t('school.setKeyLede', { host: hostOf(address) })}</p>
      <KeyField value={key} onChange={setKey} />
      <Toggle label={t('school.setRemember')} hint={t('school.setRememberHint')} checked={remember} onChange={setRemember} />
      <div className="set-actions">
        <Button variant="lantern" icon="check" onClick={() => void save()}>
          {t('school.setSave')}
        </Button>
        <Button variant="ghost" icon="play" busy={test.busy} onClick={() => void runTest()} disabled={test.busy}>
          {t('school.setTest')}
        </Button>
        {stored && (
          <Button variant="quiet" onClick={() => void forget()}>
            {t('school.setKeyForget')}
          </Button>
        )}
      </div>
      <TestLine result={test.result} />
    </div>
  );
}

function ManualSetup() {
  const { store } = useServices();
  const [s, setS] = useState<AiSettings>(() => loadAiSettings(stores()));
  const [test, setTest] = useState<{ busy: boolean; result: TestResult | null }>({ busy: false, result: null });
  const patch = (p: Partial<AiSettings>) => setS((x) => ({ ...x, ...p }));
  const configured = Boolean(s.baseUrl || s.apiKey);

  const save = async () => {
    saveAiSettings(s, stores());
    await refreshConfig();
    showToast(t('school.setManualSaved'), { kind: 'success' });
  };

  const forget = async () => {
    clearAiSettings(stores());
    setS(loadAiSettings(stores()));
    await refreshConfig();
    showToast(t('school.setManualForgot'));
  };

  const runTest = async () => {
    setTest({ busy: true, result: null });
    const baseUrl = (s.baseUrl || OPENAI_BASE_URL).replace(/\/+$/, '');
    const model = s.model || (baseUrl === OPENAI_BASE_URL ? 'gpt-5' : 'amble-default');
    const result = await testEndpoint({ baseUrl, model, auth: s.apiKey ? { type: 'bearer', key: s.apiKey } : { type: 'none' } }, { store });
    setTest({ busy: false, result });
    announce(result.ok ? t('school.setTestOk', { time: formatSeconds(result.ms) }) : result.message);
  };

  return (
    <details className="set-manual" open={configured}>
      <summary className="set-manual__summary">
        <Icon name="settings" size={18} />
        {t('school.setManualTitle')}
        <span className="set-manual__chev">
          <SchoolIcon name="next" size={18} />
        </span>
      </summary>
      <div className="set-manual__body">
        <p className="set-row__hint">{t('school.setManualLede')}</p>
        <Field label={t('school.setBaseUrl')} hint={t('school.setBaseUrlHint')} value={s.baseUrl} placeholder={OPENAI_BASE_URL} spellCheck={false} autoComplete="off" inputMode="url" onChange={(e) => patch({ baseUrl: e.target.value.trim() })} />
        <KeyField value={s.apiKey} onChange={(apiKey) => patch({ apiKey })} />
        <div className="set-two">
          <Field label={t('school.setModel')} value={s.model} placeholder="gpt-5" spellCheck={false} autoComplete="off" onChange={(e) => patch({ model: e.target.value.trim() })} />
          <Field label={t('school.setFastModel')} value={s.fastModel} placeholder="gpt-5-mini" spellCheck={false} autoComplete="off" onChange={(e) => patch({ fastModel: e.target.value.trim() })} />
        </div>
        <Toggle label={t('school.setRemember')} hint={t('school.setRememberHint')} checked={s.rememberKey} onChange={(rememberKey) => patch({ rememberKey })} />
        <div className="set-actions">
          <Button variant="lantern" icon="check" onClick={() => void save()}>
            {t('school.setSave')}
          </Button>
          <Button variant="ghost" icon="play" busy={test.busy} onClick={() => void runTest()} disabled={test.busy}>
            {t('school.setTest')}
          </Button>
          {configured && (
            <Button variant="quiet" onClick={() => void forget()}>
              {t('school.setForget')}
            </Button>
          )}
        </div>
        <TestLine result={test.result} />
      </div>
    </details>
  );
}

export function AiSection() {
  const { school } = useServices();
  const ai = useStore((s) => s.config.ai);
  const aiMode = useStore((s) => s.config.aiMode);
  const level = useStore((s) => s.config.level);
  const classLink = useStore((s) => s.config.classLink);
  const schoolBuild = useStore((s) => s.config.school);

  const host = ai?.baseUrl ? hostOf(ai.baseUrl) : null;
  const district = ai?.district?.name ?? classLink?.district ?? null;
  const on = Boolean(ai?.enabled) && aiMode !== 'off';
  let status: string;
  let detail: string | null = null;
  if (!ai) status = t('school.setChecking');
  else if (on && aiMode === 'explain') {
    status = t('school.setExplainOnly');
    detail = t('school.setExplainDetail');
  } else if (on) status = district && host ? t('school.setOnFrom', { district, host }) : host ? t('school.setOnHost', { host }) : t('school.setOn');
  else {
    status = t('school.setOff');
    detail = ai.enabled ? t('school.setOffTeacher') : offWords(ai);
  }
  const managed = ai && (ai.source === 'managed' || ai.source === 'build' || ai.locked.includes('ai'));
  const setup = setupOffered(ai, schoolBuild);
  const manual = setup === 'manual';

  const leave = async () => {
    if (!classLink) return;
    const ok = await confirmUser({ title: t('school.setLeaveTitle', { cls: classLink.cls }), body: t('school.setLeaveBody'), ok: t('school.setLeave') });
    if (!ok) return;
    await school.leave();
    const said = t('school.setLeft', { cls: classLink.cls });
    showToast(said);
    announce(said);
  };

  return (
    <div className="set-ai">
      <Group>
        <div className={cx('set-status', on ? 'set-status--on' : 'set-status--off')} data-testid="ai-status">
          <span className="set-status__dot" aria-hidden="true" />
          <div className="set-status__words">
            <p className="set-status__line">{status}</p>
            {detail && <p className="set-row__hint">{detail}</p>}
            {managed && (
              <p className="set-lock">
                <Icon name="lock" size={16} />
                {t('school.setManaged')}
              </p>
            )}
            {ai?.requestsMayBeReviewed && on && <p className="set-row__hint">{t('school.setReviewed')}</p>}
          </div>
        </div>
      </Group>

      {setup === 'key' && ai?.userKeyFor && (
        <Group title={t('school.setKeyTitle')}>
          <KeySetup address={ai.userKeyFor} model={ai.model} />
        </Group>
      )}

      <Group title={t('school.setClassTitle')}>
        {classLink ? (
          <div className="set-class">
            <Icon name="teacher" size={24} />
            <div className="set-class__words">
              <p className="set-class__name" data-testid="class-name">
                {classLink.cls}
              </p>
              <p className="set-row__hint">{ai?.expired ? t('school.setOffExpired') : t(LEVEL_WORDS[level])}</p>
            </div>
            <Button variant="ghost" size={38} onClick={() => void leave()}>
              {t('school.setLeave')}
            </Button>
          </div>
        ) : (
          <p className="set-row__hint">{t('school.setNoClass')}</p>
        )}
      </Group>

      <Group title={t('school.setSentTitle')}>
        <p className="set-row__hint">{t('school.setSentText')}</p>
        <p>
          <Link to={{ name: 'page', page: 'sent' }} className="btn btn--ghost btn--h44">
            <Icon name="info" size={20} />
            <span className="btn__label">{t('common.routeSent')}</span>
          </Link>
        </p>
      </Group>

      {manual && (
        <Group>
          <ManualSetup />
        </Group>
      )}
      {!manual && !schoolBuild && ai?.locked.includes('ai') && (
        <p className="set-lock">
          <Icon name="lock" size={16} />
          {t('school.setBySchool')}
        </p>
      )}
    </div>
  );
}
