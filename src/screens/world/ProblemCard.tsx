/**
 * Problems (§2.6): when the game breaks while playing, a paper card over the world says where ("Something
 * in the game broke (boss.js, line 42).") with [Ask Amble to fix it] (AI on), [Show me the line] and
 * [Restart]. A twist's own error offers [Turn {name} off] instead, and the AI is never asked to fix it.
 * The ⋯ menu's Problems sheet lists them all.
 */
import { useState } from 'react';
import { lookInside } from '../code/open';
import { t } from '../../i18n';
import type { PlayerError, World } from '../../model/types';
import { setTwist } from '../../state/session';
import { useStore } from '../../state/store';
import { Button, Dialog, IconButton } from '../../ui/components';
import { askBusy, runAsk } from '../../world/ask';
import { useAiOn } from './hooks';

/** The problem the card shows: the latest fatal one, else the latest one seen more than once. */
export function problemToShow(problems: readonly PlayerError[]): PlayerError | null {
  for (let i = problems.length - 1; i >= 0; i--) if (problems[i].fatal && problems[i].phase !== 'frozen') return problems[i];
  return null;
}

export function problemText(p: PlayerError, twistName: string | null): string {
  if (p.twist) return t('world.problemTwist', { name: twistName ?? p.twist });
  if (p.file && p.line) return t('world.problemLine', { file: p.file, line: p.line });
  return t('world.problemPlain');
}

export function ProblemCard({ world, onRestart }: { world: World; onRestart(): void }) {
  const problem = useStore((s) => problemToShow(s.session.problems));
  const dismissed = useStore((s) => s.session.stopped !== null);
  const twistName = useStore((s) => (problem?.twist ? s.session.manifest?.twists.find((x) => x.id === problem.twist)?.name ?? null : null));
  const aiOn = useAiOn(world.assignment);
  const busy = useStore((s) => !!s.ai.job);
  const [hidden, setHidden] = useState<PlayerError | null>(null);
  if (!problem || dismissed || problem === hidden) return null;
  const clear = () => setHidden(problem);
  return (
    <div className="problem-card paper paper--cut on-paper" role="alert" data-testid="problem-card">
      <p className="problem-card__text">{problemText(problem, twistName)}</p>
      <div className="problem-card__actions">
        {problem.twist ? (
          <Button
            variant="lantern"
            size={38}
            onClick={() => {
              setTwist(problem.twist!, false);
              clear();
              onRestart();
            }}
          >
            {t('world.turnOff', { name: twistName ?? problem.twist })}
          </Button>
        ) : (
          aiOn && (
            <Button variant="lantern" icon="sparkle" size={38} disabled={busy} onClick={() => !askBusy() && void runAsk('fix', t('world.askFix'), { problems: [problem] })}>
              {t('world.askFix')}
            </Button>
          )
        )}
        {problem.file && !problem.twist && (
          <Button variant="paper" size={38} onClick={() => lookInside({ worldId: world.id, file: problem.file ?? 'game.js', line: problem.line })}>
            {t('world.showLine')}
          </Button>
        )}
        <Button
          variant="paper"
          icon="restart"
          size={38}
          onClick={() => {
            clear();
            onRestart();
          }}
        >
          {t('world.restart')}
        </Button>
      </div>
      <IconButton icon="close" label={t('common.dismiss')} size={38} variant="quiet" tooltip={false} className="problem-card__close" onClick={clear} />
    </div>
  );
}

export function ProblemsSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const problems = useStore((s) => s.session.problems);
  return (
    <Dialog open={open} onClose={onClose} title={t('world.problemsTitle')} size="md">
      {problems.length ? (
        <ul className="problems-list" data-testid="problems-list">
          {problems.map((p, i) => (
            <li key={i} className="problems-list__item">
              <p className="problems-list__message">{p.message}</p>
              <p className="problems-list__meta">
                {p.file && p.line ? `${t('world.problemWhere', { file: p.file, line: p.line })} · ` : ''}
                {p.count > 1 ? t('world.problemTimes', { n: p.count }) : t('world.problemOnce')}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dialog__text">{t('world.problemsNone')}</p>
      )}
    </Dialog>
  );
}
