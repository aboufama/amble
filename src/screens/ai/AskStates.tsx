/**
 * The wish box (§2.8 as MAGIC-BRIEF.md reshapes it): everything inside the World's "Change your world"
 * panel. The student asks the world for something and the world changes; the machinery stays out of sight.
 *
 * - Idle: a field whose example wishes rotate every 8 s, idea chips, **Make it happen** (Ctrl+Enter), and
 *   a small ⓘ **How wishes work**, the only place a student can read how it works (never shown by itself).
 * - Working: the wish read-only, "Working on it…" with a thin indeterminate bar and **Stop**; the game
 *   keeps playing. Waiting its turn says so in plain words.
 * - What lands: the "Done!" toast over the world (`WishToast`); here, only what needs the student (a new
 *   member to draw, lines they wrote, a gentler version) and the next ideas.
 * - Private info, refusals, the crisis card and a wish that didn't work, in plain, kind words.
 * - When wishes can't happen (off, explain-only, offline, quota, blocked, key or link problems): one
 *   quiet line where the box was, and nothing else.
 * - A wish that only turns a dial or flips a twist is done on the device at once (the steer toast).
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { navigate } from '../../app/router';
import { useServices } from '../../app/services';
import type { GameManifest } from '../../cores/play';
import { t, type MessageKey } from '../../i18n';
import type { AiOutcome, CastKey, SafetyVerdict, World } from '../../model/types';
import { alternativesFor, refusalNote } from '../../pipeline/safety';
import { applySteer, goBackBefore, leftOutText, noteLocalRefusal, startChange, stopJob } from '../../state/ai';
import { announce } from '../../state/app';
import { getState, useStore } from '../../state/store';
import { Button, Chip, IconButton, TextArea } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { CrisisCard } from './CrisisCard';
import { HowWishesWork } from './HowWishesWork';
import { bossName, heroOf, memberName, nameInSentence, starterOf, useAmbleAi } from './hooks';
import { PiiWarning } from './PiiWarning';
import { RefusalCard } from './RefusalCard';
import { SafetyNote } from './SafetyNote';
import { WishWorking } from './WishWorking';
import { addedMemberText, restingLine, steerText } from './words';
import './ai.css';

export interface AskStatesProps {
  world: World;
  manifest: GameManifest | null;
  /** Change mode's scope ("About the Moon King ✕"). */
  scope: CastKey | null;
  onClearScope(): void;
}

/** Five example wishes per world type (§2.8), with the world's own hero and boss names. */
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

/** Failures whose details are the game's own problems (file and line), worth showing the curious. */
const CODE_FAILURES = new Set(['validation', 'runtime', 'mismatch']);

type LocalRefusal = { note: string; alternatives: string[] };

/**
 * The words stay in the field after a failure, a stop or a pause in wishes (the student's own words: a fix
 * from the problem card has none to give back).
 */
function keptWords(outcome: AiOutcome | null, request: string | undefined, task: string | undefined): string {
  if (!outcome || !request || task === 'fix' || task === 'build') return '';
  return outcome.kind === 'failed' || outcome.kind === 'cancelled' || outcome.kind === 'unavailable' ? request : '';
}

export function AskStates({ world, manifest, scope, onClearScope }: AskStatesProps) {
  const services = useServices();
  const ai = useAmbleAi();
  const status = useStore((s) => s.ai.status);
  const job = useStore((s) => (s.ai.job?.worldId === world.id ? s.ai.job : null));
  const outcomeFor = useStore((s) => (s.ai.outcomeFor?.worldId === world.id ? s.ai.outcomeFor : null));
  const outcome = useStore((s) => (s.ai.outcomeFor?.worldId === world.id ? s.ai.lastOutcome : null));
  const level = ai?.levelFor(world) ?? 'middle';

  const [text, setText] = useState(() => keptWords(outcome, outcomeFor?.request, outcomeFor?.task));
  const [verdict, setVerdict] = useState<SafetyVerdict | null>(null);
  const [anyway, setAnyway] = useState(false);
  const [localRefusal, setLocalRefusal] = useState<LocalRefusal | null>(null);
  const [crisisOpen, setCrisisOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [later, setLater] = useState<CastKey[]>([]);
  const [ph, setPh] = useState(0);
  const field = useRef<HTMLTextAreaElement>(null);
  const piiId = useId();
  const seenCrisis = useRef(outcome?.kind === 'crisis' ? (outcomeFor?.at ?? 0) : 0);

  // A crisis the service found (moderation, the reply) opens the card once, and clears the words.
  useEffect(() => {
    if (outcome?.kind === 'crisis' && outcomeFor && outcomeFor.at !== seenCrisis.current) {
      seenCrisis.current = outcomeFor.at;
      setText('');
      setCrisisOpen(true);
    }
  }, [outcome, outcomeFor]);

  // After a new outcome: a wish that landed clears its words; one that didn't puts them back.
  const handled = useRef(outcomeFor?.at ?? 0);
  useEffect(() => {
    if (!outcomeFor || outcomeFor.at === handled.current) return;
    handled.current = outcomeFor.at;
    setDetails(false);
    // A change the student's own edits kept out entirely keeps its words, to ask again.
    const changed = getState().ai.changed;
    const keptOut = changed?.worldId === outcomeFor.worldId && !changed.files.length && changed.leftOut.length > 0;
    if (outcome?.kind === 'accepted' && !keptOut) setText((cur) => (cur.trim() === outcomeFor.request.trim() ? '' : cur));
    const words = keptWords(outcome, outcomeFor.request, outcomeFor.task);
    if (words) setText((cur) => cur || words);
  }, [outcome, outcomeFor]);

  // Private info is checked as the student types (debounced 400 ms, §5.13).
  useEffect(() => {
    const id = setTimeout(() => {
      const v = text.trim() ? services.ai.checkText(text, level) : null;
      setVerdict(v?.kind === 'pii' ? v : null);
    }, 400);
    return () => clearTimeout(id);
  }, [text, level, services.ai]);

  // The example wish in the empty field changes every 8 s.
  useEffect(() => {
    const id = setInterval(() => setPh((n) => n + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  const hero = heroOf(world, manifest);
  const working = job !== null;
  const resting = working ? null : restingLine(status);

  const placeholder = useMemo(() => {
    const keys = PLACEHOLDERS[starterOf(world) ?? 'any'] ?? PLACEHOLDERS.any;
    return t(keys[ph % keys.length], { hero: hero.name, boss: bossName(manifest) });
  }, [manifest, world, ph, hero.name]);

  const ideas: string[] = outcome?.kind === 'accepted' && outcome.next.length ? outcome.next.slice(0, 3) : DEFAULT_IDEAS.map((k) => t(k));

  const setWords = (words: string) => {
    setText(words);
    setAnyway(false);
    setLocalRefusal(null);
  };

  const fill = (words: string) => {
    setWords(words);
    requestAnimationFrame(() => field.current?.focus());
  };

  /** Make it happen: safety on the device, then a dial or twist the device can match, then the wish. */
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
      void noteLocalRefusal(world, v.category);
      announce(t('ai.refusedTitle'));
      return;
    }
    if (v.kind === 'pii' && (v.block || !sendAnyway)) {
      setVerdict(v);
      announce(t('ai.piiWarning'));
      return;
    }
    const steer = manifest ? services.ai.steer(words, world, manifest) : null;
    if (steer) {
      applySteer(world, steer, words);
      setWords('');
      announce(steerText(steer));
      return;
    }
    setLocalRefusal(null);
    void startChange(world, words, scope);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      ask();
    }
  };

  /** Try again: a paused helper (a web filter, say) gets another go, with the same words. */
  const retry = () => {
    ai?.retry();
    const words = text || outcomeFor?.request || '';
    if (words) ask(words);
  };

  const piiVerdict = verdict?.kind === 'pii' ? verdict : null;
  const piiBlocks = piiVerdict !== null && (piiVerdict.block || !anyway);
  const state = crisisOpen
    ? 'crisis'
    : working
      ? 'working'
      : resting
        ? status
        : localRefusal || outcome?.kind === 'refused'
          ? 'refused'
          : outcome?.kind === 'failed'
            ? 'failed'
            : outcome?.kind === 'accepted'
              ? 'done'
              : 'idle';

  const cards = (
    <>
      <HowWishesWork open={howOpen} onClose={() => setHowOpen(false)} />
      <CrisisCard
        open={crisisOpen}
        onClose={() => {
          setCrisisOpen(false);
          requestAnimationFrame(() => field.current?.focus());
        }}
      />
    </>
  );

  // ------------------------------------------------------------------ wishes are resting: one quiet line

  if (resting) {
    return (
      <div className="wish" data-testid="ai-ask" data-state={state}>
        <p className="wish-rest" data-testid="ai-status">
          <span>{resting}</span>
          {status === 'blocked' && (
            <button type="button" className="wish-link" onClick={retry}>
              {t('ai.tryAgain')}
            </button>
          )}
        </p>
        {cards}
      </div>
    );
  }

  // ------------------------------------------------------------------ pieces

  const scopeName = scope ? nameInSentence(memberName(manifest, scope)) : '';
  const scopeChip = scope && !working && (
    <div className="wish__scope">
      <Chip icon="change">{t('ai.askAbout', { name: scopeName })}</Chip>
      <IconButton icon="close" size={38} label={t('ai.askAboutClear', { name: scopeName })} onClick={onClearScope} />
    </div>
  );

  const outcomeBlock = (() => {
    if (working) return null;
    if (localRefusal) return <RefusalCard note={localRefusal.note} alternatives={localRefusal.alternatives} onPick={fill} />;
    if (!outcome) return null;
    switch (outcome.kind) {
      case 'refused':
        return <RefusalCard note={outcome.note} alternatives={outcome.alternatives} onPick={fill} />;
      case 'failed': {
        const curious = CODE_FAILURES.has(outcome.reason) && outcome.details.length > 0;
        return (
          <div className="wish-note" data-testid="ai-failed">
            <p className="wish-note__text">{outcome.message || t('ai.failed')}</p>
            <div className="wish-note__actions">
              <Button size={38} variant="ghost" icon="restart" onClick={() => ask(text || outcomeFor?.request)} disabled={!(text || outcomeFor?.request)}>
                {t('ai.tryAgain')}
              </Button>
              {curious && (
                <Button size={38} variant="quiet" aria-expanded={details} onClick={() => setDetails(!details)}>
                  {details ? t('ai.hideDetails') : t('ai.details')}
                </Button>
              )}
            </div>
            {curious && details && (
              <ul className="wish-note__details" data-testid="ai-details">
                {outcome.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        );
      }
      case 'cancelled':
        return <p className="wish-quiet">{t('ai.stoppedNothingChanged')}</p>;
      case 'fallback':
        return (
          <div className="wish-note">
            <p className="wish-note__text" role="status">
              {outcome.message}
            </p>
          </div>
        );
      case 'accepted':
        return <DoneNotes world={world} manifest={manifest} outcome={outcome} later={later} onLater={(k) => setLater([...later, k])} />;
      default:
        return null;
    }
  })();

  const canSend = text.trim().length > 0 && !working && !piiBlocks;

  return (
    <div className="wish" data-testid="ai-ask" data-state={state}>
      {outcomeBlock}
      {scopeChip}
      <TextArea
        ref={field}
        className="wish__field"
        label={t('ai.askLabel')}
        labelHidden
        rows={3}
        maxLength={600}
        value={working ? job.request : text}
        readOnly={working}
        placeholder={placeholder}
        onChange={(e) => setWords(e.target.value)}
        onKeyDown={onKey}
        aria-describedby={piiVerdict && !working ? piiId : undefined}
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
      {working ? (
        <WishWorking job={job} onStop={() => stopJob(world.id)} />
      ) : (
        <>
          <div className="wish__ideas" role="group" aria-label={t('ai.askIdeas')}>
            {ideas.map((idea) => (
              <Chip key={idea} onClick={() => fill(idea)}>
                {idea}
              </Chip>
            ))}
          </div>
          <div className="wish__foot">
            <button type="button" className="wish-link wish__how" aria-haspopup="dialog" onClick={() => setHowOpen(true)} data-testid="wish-how">
              <Icon name="info" size={16} />
              {t('ai.howLink')}
            </button>
            <Button className="wish__go" variant="lantern" disabled={!canSend} aria-keyshortcuts="Control+Enter" title={t('ai.askKeyHint')} onClick={() => ask()} data-testid="ai-send">
              {t('ai.askButton')}
            </Button>
          </div>
        </>
      )}
      {cards}
    </div>
  );
}

/** What a landed wish still asks of the student: a gentler version, a new member to draw, lines they wrote. */
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
  const leftOut = changed?.leftOut ?? [];
  return (
    <>
      <SafetyNote note={outcome.safety} />
      {fresh && (
        <div className="wish-note">
          <p className="wish-note__text" data-testid="ai-added">
            {addedMemberText(fresh.name)}
          </p>
          <div className="wish-note__actions">
            <Button size={38} variant="lantern" icon="draw" onClick={() => navigate({ name: 'draw', worldId: world.id, key: fresh.key })}>
              {t('ai.drawIt')}
            </Button>
            <Button size={38} variant="ghost" onClick={() => onLater(fresh.key)}>
              {t('ai.later')}
            </Button>
          </div>
        </div>
      )}
      {leftOut.length > 0 && (
        <div className="wish-note">
          <p className="wish-note__text" role="status" data-testid="ai-left-out">
            {leftOutText(leftOut)}
          </p>
        </div>
      )}
      {handFile && (
        <div className="wish-note">
          <p className="wish-note__text" data-testid="ai-hand-edits">
            {t('ai.handEdits', { file: handFile })}
          </p>
          <div className="wish-note__actions">
            <Button size={38} variant="ghost" icon="eye" onClick={() => navigate({ name: 'code', worldId: world.id, file: handFile })}>
              {t('ai.seeThem')}
            </Button>
            <Button size={38} variant="ghost" icon="undo" onClick={() => void goBackBefore(world.id)}>
              {t('ai.goBack')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
