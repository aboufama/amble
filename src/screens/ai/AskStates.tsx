/**
 * The inside of the Ask card, in every state of §2.8 (M5; M2's AskCard is the shell with its title and
 * badge): idle (the field with genre placeholders rotating every 8 s, idea chips, ★ Ask, Ctrl+Enter), the
 * AI explainer before the first Ask on a device, personal info, answered locally (the steer), working (the
 * request read-only with the footprint list and Stop), done (the toned-down note, "Draw it now?", hand
 * edits), refused, crisis, failed, explain only, and the helper's status lines (off, offline, blocked,
 * quota, class link expired, busy). With the AI off the field still turns dials and flips twists (§5.10).
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from '../../app/Link';
import { navigate } from '../../app/router';
import { useServices } from '../../app/services';
import type { GameManifest } from '../../cores/play';
import { t, type MessageKey } from '../../i18n';
import type { AiOutcome, CastKey, SafetyVerdict, World } from '../../model/types';
import { alternativesFor, refusalNote } from '../../pipeline/safety';
import {
  applySteer,
  askAi,
  closeExplainer,
  confirmExplainer,
  goBackBefore,
  noteLocalRefusal,
  startExplain,
  stopExplain,
  stopJob,
} from '../../state/ai';
import { announce } from '../../state/app';
import { useStore } from '../../state/store';
import { Button, Chip, Footprints, IconButton, PaperCard, TextArea } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { AiExplainer } from './AiExplainer';
import { AiProgressList } from './AiProgressList';
import { CrisisCard } from './CrisisCard';
import { bossName, heroOf, memberName, nameInSentence, starterOf, useAmbleAi } from './hooks';
import { PiiWarning } from './PiiWarning';
import { RefusalCard } from './RefusalCard';
import { SafetyNote } from './SafetyNote';
import { addedMemberText, steerText } from './words';
import './ai.css';

export interface AskStatesProps {
  world: World;
  manifest: GameManifest | null;
  /** Change mode's scope ("About the Moon King ✕"). */
  scope: CastKey | null;
  onClearScope(): void;
}

/** Five placeholders per world type (§2.8), with the world's own hero and boss names. */
const PLACEHOLDERS: Record<string, MessageKey[]> = {
  'moon-king': ['ai.phBoss1', 'ai.phBoss2', 'ai.phBoss3', 'ai.phBoss4', 'ai.phBoss5'],
  'sky-run': ['ai.phRun1', 'ai.phRun2', 'ai.phRun3', 'ai.phRun4', 'ai.phRun5'],
  'wobble-tower': ['ai.phToy1', 'ai.phToy2', 'ai.phToy3', 'ai.phToy4', 'ai.phToy5'],
  'lantern-maze': ['ai.phMaze1', 'ai.phMaze2', 'ai.phMaze3', 'ai.phMaze4', 'ai.phMaze5'],
  'clanks-climb': ['ai.phClimb1', 'ai.phClimb2', 'ai.phClimb3', 'ai.phClimb4', 'ai.phClimb5'],
  any: ['ai.phAny1', 'ai.phAny2', 'ai.phAny3', 'ai.phAny4', 'ai.phAny5'],
};

const DEFAULT_IDEAS: MessageKey[] = ['ai.ideaHarder', 'ai.ideaPowerUp', 'ai.ideaSurprise'];
const ROTATE_MS = 8000;

/** Statuses where only the local matcher can answer (nothing can be sent). */
const LOCAL_ONLY = new Set(['off', 'offline', 'expired']);

type LocalRefusal = { note: string; alternatives: string[] };

/** The words stay in the field after a failure, a stop or an unavailable helper. */
function keptWords(outcome: AiOutcome | null, request: string | undefined): string {
  if (!outcome || !request) return '';
  return outcome.kind === 'failed' || outcome.kind === 'cancelled' || outcome.kind === 'unavailable' ? request : '';
}

export function AskStates({ world, manifest, scope, onClearScope }: AskStatesProps) {
  const services = useServices();
  const ai = useAmbleAi();
  const status = useStore((s) => s.ai.status);
  const job = useStore((s) => (s.ai.job?.worldId === world.id ? s.ai.job : null));
  const outcomeFor = useStore((s) => (s.ai.outcomeFor?.worldId === world.id ? s.ai.outcomeFor : null));
  const outcome = useStore((s) => (s.ai.outcomeFor?.worldId === world.id ? s.ai.lastOutcome : null));
  const explainerOpen = useStore((s) => s.ai.explainer?.worldId === world.id);
  const explaining = useStore((s) => s.ai.explaining === world.id);
  const explained = useStore((s) => (s.ai.explain?.worldId === world.id ? s.ai.explain : null));
  const school = useStore((s) => s.config.school);
  const level = ai?.levelFor(world) ?? 'middle';

  const [text, setText] = useState(() => keptWords(outcome, outcomeFor?.request));
  const [verdict, setVerdict] = useState<SafetyVerdict | null>(null);
  const [anyway, setAnyway] = useState(false);
  const [localRefusal, setLocalRefusal] = useState<LocalRefusal | null>(null);
  const [needsAi, setNeedsAi] = useState(false);
  const [crisisOpen, setCrisisOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [later, setLater] = useState<CastKey[]>([]);
  const [ph, setPh] = useState(0);
  const field = useRef<HTMLTextAreaElement>(null);
  const piiId = useId();
  const seenCrisis = useRef(outcome?.kind === 'crisis' ? (outcomeFor?.at ?? 0) : 0);

  // A crisis from the helper (moderation, the model) opens the card once, and clears the words.
  useEffect(() => {
    if (outcome?.kind === 'crisis' && outcomeFor && outcomeFor.at !== seenCrisis.current) {
      seenCrisis.current = outcomeFor.at;
      setText('');
      setCrisisOpen(true);
    }
  }, [outcome, outcomeFor]);

  // After a new outcome: an accepted change clears the words it came from; a failure puts them back.
  const handled = useRef(outcomeFor?.at ?? 0);
  useEffect(() => {
    if (!outcomeFor || outcomeFor.at === handled.current) return;
    handled.current = outcomeFor.at;
    if (outcome?.kind === 'accepted') setText((cur) => (cur.trim() === outcomeFor.request.trim() ? '' : cur));
    const words = keptWords(outcome, outcomeFor.request);
    if (words) setText((cur) => cur || words);
  }, [outcome, outcomeFor]);

  // Personal info is checked as the student types (debounced 400 ms, §5.13).
  useEffect(() => {
    const id = setTimeout(() => {
      const v = text.trim() ? services.ai.checkText(text, level) : null;
      setVerdict(v?.kind === 'pii' ? v : null);
    }, 400);
    return () => clearTimeout(id);
  }, [text, level, services.ai]);

  // The placeholder rotates every 8 s among five examples for this kind of world.
  useEffect(() => {
    const id = setInterval(() => setPh((n) => n + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  const hero = heroOf(world, manifest);
  const explainOnly = status === 'explain-only';
  const localOnly = LOCAL_ONLY.has(status);
  const working = job !== null;

  const placeholder = useMemo(() => {
    if (explainOnly) return t('ai.askExplainPlaceholder');
    if (localOnly) {
      const dial = manifest?.dials[0];
      const twist = manifest?.twists.find((tw) => tw.available && !tw.on);
      const local = [dial ? t('ai.phLocalDial', { label: dial.label }) : null, twist ? t('ai.phLocalTwist', { name: twist.name }) : null].filter((x): x is string => !!x);
      return local.length ? local[ph % local.length] : t('ai.phLocalAny');
    }
    const keys = PLACEHOLDERS[starterOf(world) ?? 'any'] ?? PLACEHOLDERS.any;
    return t(keys[ph % keys.length], { hero: hero.name, boss: bossName(manifest) });
  }, [explainOnly, localOnly, manifest, world, ph, hero.name]);

  const ideas: string[] = outcome?.kind === 'accepted' && outcome.next.length ? outcome.next.slice(0, 3) : DEFAULT_IDEAS.map((k) => t(k));

  const setWords = (words: string) => {
    setText(words);
    setAnyway(false);
    setLocalRefusal(null);
    setNeedsAi(false);
  };

  const fill = (words: string) => {
    setWords(words);
    requestAnimationFrame(() => field.current?.focus());
  };

  /** ★ Ask: local safety, the local matcher, then the AI helper (the explainer first, once per device). */
  const ask = (given?: string, sendAnyway = anyway) => {
    const words = (given ?? text).trim();
    if (!words || working) return;
    const v = services.ai.checkText(words, level);
    if (v.kind === 'crisis') {
      setText('');
      setCrisisOpen(true);
      void noteLocalRefusal(world, 'support');
      return;
    }
    if (v.kind === 'refuse') {
      setLocalRefusal({ note: refusalNote(v.category), alternatives: alternativesFor(v.category, level) });
      void noteLocalRefusal(world, 'request');
      announce(t('ai.refusedTitle'));
      return;
    }
    if (v.kind === 'pii' && (v.block || !sendAnyway)) {
      setVerdict(v);
      announce(t('ai.piiWarning'));
      return;
    }
    if (explainOnly) {
      void startExplain(world, words);
      return;
    }
    const steer = manifest ? services.ai.steer(words, world, manifest) : null;
    if (steer) {
      applySteer(world, steer, words);
      setWords('');
      announce(steerText(steer));
      return;
    }
    if (localOnly) {
      setNeedsAi(true);
      return;
    }
    setLocalRefusal(null);
    setNeedsAi(false);
    void askAi(world, words, scope);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      ask();
    }
  };

  const retry = () => {
    ai?.retry();
    ask(text || outcomeFor?.request || '');
  };

  const piiVerdict = verdict?.kind === 'pii' ? verdict : null;
  const piiBlocks = piiVerdict !== null && (piiVerdict.block || !anyway);
  const state = crisisOpen
    ? 'crisis'
    : working
      ? 'working'
      : explainOnly
        ? 'explain'
        : status !== 'ready'
          ? status
          : localRefusal || outcome?.kind === 'refused'
            ? 'refused'
            : outcome?.kind === 'failed'
              ? 'failed'
              : outcome?.kind === 'accepted'
                ? 'done'
                : 'idle';

  // ------------------------------------------------------------------ pieces

  const scopeName = scope ? nameInSentence(memberName(manifest, scope)) : '';
  const scopeChip = scope && !explainOnly && (
    <div className="ai-ask__scope">
      <Chip icon="change">{t('ai.askAbout', { name: scopeName })}</Chip>{' '}
      <IconButton icon="close" size={38} label={t('ai.askAboutClear', { name: scopeName })} onClick={onClearScope} />
    </div>
  );

  const statusBlock = (() => {
    if (working || explainOnly || status === 'ready') return null;
    const host = ai?.host() ?? t('ai.hostFallback');
    switch (status) {
      case 'off':
        return (
          <div className="ai-status" data-testid="ai-status">
            <p className="ai-status__text">{t('ai.offTitle')}</p>
            {school ? (
              <p className="ai-status__sub">{t('ai.offSchool')}</p>
            ) : (
              <div className="ai-status__actions">
                <Button size={38} variant="ai" icon="settings" onClick={() => navigate({ name: 'settings', section: 'ai' })}>
                  {t('ai.offSetUp')}
                </Button>
              </div>
            )}
          </div>
        );
      case 'blocked':
        return (
          <div className="ai-status ai-status--warn" data-testid="ai-status">
            <p className="ai-status__text">{t('ai.blocked', { host })}</p>
            <div className="ai-status__actions">
              <Button size={38} variant="ghost" icon="restart" onClick={retry}>
                {t('ai.tryAgain')}
              </Button>
            </div>
          </div>
        );
      default:
        return (
          <div className={status === 'busy' ? 'ai-status' : 'ai-status ai-status--warn'} data-testid="ai-status">
            <p className="ai-status__text">{ai ? statusText(status) : t('ai.offTitle')}</p>
          </div>
        );
    }
  })();

  const outcomeBlock = (() => {
    if (working) return null;
    if (localRefusal) return <RefusalCard note={localRefusal.note} alternatives={localRefusal.alternatives} onPick={fill} />;
    if (!outcome) return null;
    switch (outcome.kind) {
      case 'refused':
        return <RefusalCard note={outcome.note} alternatives={outcome.alternatives} onPick={fill} />;
      case 'failed':
        return (
          <div className="ai-failed" data-testid="ai-failed">
            <p className="ai-failed__text" role="alert">
              {outcome.message || t('ai.failed')}
            </p>
            <div className="ai-paper__actions">
              <Button size={38} variant="ghost" icon="restart" onClick={retry} disabled={!(text || outcomeFor?.request)}>
                {t('ai.tryAgain')}
              </Button>
              {outcome.details.length > 0 && (
                <Button size={38} variant="quiet" aria-expanded={details} onClick={() => setDetails(!details)}>
                  {details ? t('ai.hideDetails') : t('ai.details')}
                </Button>
              )}
            </div>
            {details && (
              <ul className="ai-failed__details" data-testid="ai-details">
                {outcome.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        );
      case 'cancelled':
        return <p className="ai-ask__note">{t('ai.stoppedNothingChanged')}</p>;
      case 'fallback':
        return (
          <PaperCard className="ai-paper" tilt={-0.5} cut>
            <p className="ai-paper__text" role="status">
              {outcome.message}
            </p>
          </PaperCard>
        );
      case 'accepted':
        return <DoneNotes world={world} manifest={manifest} outcome={outcome} later={later} onLater={(k) => setLater([...later, k])} />;
      default:
        return null;
    }
  })();

  const explainBlock = explainOnly && (explaining || explained) && (
    <PaperCard className="ai-paper" tilt={0.4}>
      {explaining ? (
        <p className="ai-paper__text" role="status">
          <Footprints label={t('ai.explainWorking')} /> {t('ai.explainWorking')}
        </p>
      ) : explained?.reply ? (
        <div data-testid="ai-explained" role="status">
          <p className="ai-paper__text">{explained.reply.answer}</p>
          {explained.reply.lines.length > 0 && (
            <ul className="ai-card__lines">
              {explained.reply.lines.slice(0, 5).map((l, i) => (
                <li key={i} className="ai-paper__text">
                  <strong>{l.from === l.to ? t('ai.explainLine', { n: l.from }) : t('ai.explainLines', { from: l.from, to: l.to })}</strong> {l.note}
                </li>
              ))}
            </ul>
          )}
          <div className="ai-paper__actions">
            <Button size={38} variant="paper" icon="list" onClick={() => navigate({ name: 'code', worldId: world.id, file: explained.path })}>
              {t('ai.explainSeeCode')}
            </Button>
          </div>
        </div>
      ) : explained?.error ? (
        <p className="ai-paper__text" role="status">
          {explained.error}
        </p>
      ) : null}
    </PaperCard>
  );

  const canSend = text.trim().length > 0 && !working && !piiBlocks && !explaining;

  return (
    <div className="ai-ask" data-testid="ai-ask" data-state={state}>
      {statusBlock}
      {outcomeBlock}
      {explainBlock}
      {scopeChip}
      {working && job.task === 'build' && <p className="ai-ask__note">{t('ai.askStillWorking')}</p>}
      <TextArea
        ref={field}
        className="ai-ask__field"
        label={explainOnly ? t('ai.askExplainLabel') : t('ai.askLabel')}
        labelHidden={!explainOnly}
        rows={3}
        maxLength={600}
        value={working ? job.request : text}
        readOnly={working}
        placeholder={placeholder}
        onChange={(e) => setWords(e.target.value)}
        onKeyDown={onKey}
        aria-describedby={piiVerdict ? piiId : undefined}
        data-testid="ai-field"
      />
      {piiVerdict && !working && (
        <PiiWarning
          id={piiId}
          text={text}
          verdict={piiVerdict}
          onRemove={(cleaned) => {
            setWords(cleaned);
            setVerdict(null);
            field.current?.focus();
          }}
          onSendAnyway={
            piiVerdict.block
              ? undefined
              : () => {
                  setAnyway(true);
                  ask(text, true);
                }
          }
        />
      )}
      {needsAi && <p className="ai-ask__note" role="status">{t('ai.needsAi')}</p>}
      {working ? (
        <AiProgressList job={job} onStop={() => stopJob(world.id)} />
      ) : (
        <div className="ai-ask__row">
          {!explainOnly && !localOnly && (
            <div className="ai-ask__chips" role="group" aria-label={t('ai.askIdeas')}>
              {ideas.map((idea) => (
                <Chip key={idea} onClick={() => fill(idea)}>
                  {idea}
                </Chip>
              ))}
            </div>
          )}
          {explaining ? (
            <Button className="ai-ask__send" variant="ghost" onClick={stopExplain}>
              {t('ai.stop')}
            </Button>
          ) : (
            <Button
              className="ai-ask__send"
              variant="lantern"
              icon={explainOnly ? 'info' : 'star'}
              disabled={!canSend}
              aria-keyshortcuts="Control+Enter"
              title={t('ai.askKeyHint')}
              onClick={() => ask()}
              data-testid="ai-send"
            >
              {explainOnly ? t('ai.askExplainButton') : t('ai.askButton')}
            </Button>
          )}
        </div>
      )}
      <p className="ai-ask__info">
        <Icon name="info" size={16} />
        {t('ai.askInfo')}{' '}
        <Link className="ai-link" to={{ name: 'page', page: 'sent' }}>
          {t('ai.askWhatsSent')}
        </Link>
      </p>
      <AiExplainer
        open={explainerOpen}
        onClose={() => void confirmExplainer()}
        onWhatsSent={() => {
          closeExplainer();
          navigate({ name: 'page', page: 'sent' });
        }}
      />
      <CrisisCard
        open={crisisOpen}
        onClose={() => {
          setCrisisOpen(false);
          requestAnimationFrame(() => field.current?.focus());
        }}
      />
      {/* The hero's name, for the progress line's screen-reader text. */}
      <span className="sr-only">{working ? t('ai.heroWalking', { hero: hero.name }) : ''}</span>
    </div>
  );
}

/** The helper's status in words (§2.8), for the statuses that have no action of their own. */
function statusText(status: string): string {
  switch (status) {
    case 'offline':
      return t('ai.offline');
    case 'quota':
      return t('ai.quota');
    case 'expired':
      return t('ai.expired');
    case 'rejected':
      return t('ai.rejected');
    case 'busy':
      return t('ai.busy');
    default:
      return t('ai.offTitle');
  }
}

/** Done (§2.8): the toned-down note, a new required member to draw, and lines the student wrote. */
function DoneNotes({
  world,
  manifest,
  outcome,
  later,
  onLater,
}: {
  world: World;
  manifest: GameManifest | null;
  outcome: Extract<AiOutcome, { kind: 'accepted' }>;
  later: CastKey[];
  onLater(key: CastKey): void;
}) {
  const changed = useStore((s) => (s.ai.changed?.worldId === world.id ? s.ai.changed : null));
  const art = manifest ?? outcome.manifest;
  const fresh = outcome.newArt
    .map((k) => art.art.find((a) => a.key === k))
    .find((a) => a && a.required && !world.cast[a.key]?.art && !later.includes(a.key));
  const handFile = outcome.handEditsTouched ? (changed?.handFile ?? null) : null;
  const addedText = fresh ? addedMemberText(fresh.name) : '';
  return (
    <>
      <SafetyNote note={outcome.safety} />
      {fresh && (
        <PaperCard className="ai-paper" tilt={0.6} cut>
          <p className="ai-paper__text" data-testid="ai-added">
            {addedText}
          </p>
          <div className="ai-paper__actions">
            <Button size={38} variant="lantern" icon="draw" onClick={() => navigate({ name: 'draw', worldId: world.id, key: fresh.key })}>
              {t('ai.drawIt')}
            </Button>
            <Button size={38} variant="paper" onClick={() => onLater(fresh.key)}>
              {t('ai.later')}
            </Button>
          </div>
        </PaperCard>
      )}
      {handFile && (
        <PaperCard className="ai-paper" tilt={-0.4} cut>
          <p className="ai-paper__text" data-testid="ai-hand-edits">
            {t('ai.handEdits', { file: handFile })}
          </p>
          <div className="ai-paper__actions">
            <Button size={38} variant="paper" icon="eye" onClick={() => navigate({ name: 'code', worldId: world.id, file: handFile })}>
              {t('ai.seeThem')}
            </Button>
            <Button size={38} variant="paper" icon="undo" onClick={() => void goBackBefore(world.id)}>
              {t('ai.goBack')}
            </Button>
          </div>
        </PaperCard>
      )}
    </>
  );
}
