/**
 * The side panel (§2.11): **Watch {name} move** (the live preview), **Moves** (Stand, Walk, Run, Jump,
 * Fall, Ouch, Attack, Wave, plus Fly, Swim or Wiggle for those kinds), **Feel** for the move that plays,
 * **Draw this move yourself?**, and the note that bones are made on this Chromebook.
 */
import { memo, useState } from 'react';
import type { RouteOf } from '../../app/routes';
import { navigate } from '../../app/router';
import type { BonesController, BonesStep } from '../../bones/bonesController';
import type { BoundRig } from '../../cores/rig';
import { firstMove, moveWord, movesFor } from '../../bones/words';
import { midSentence, t } from '../../i18n';
import { useReducedMotion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { FeelSliders } from './FeelSliders';
import { MovePreview } from './MovePreview';

export interface MovesPanelProps {
  ctl: BonesController;
  /** The newest step (its kind and the moves' Feel), not the bones mid-drag: the panel sits out drags. */
  step: BonesStep | null;
  bound: BoundRig | null;
  name: string;
  busy: boolean;
  dragging: boolean;
  aiHelped: boolean;
  route: RouteOf<'bones'> | RouteOf<'bonesFree'>;
}

export const MovesPanel = memo(function MovesPanel({ ctl, step, bound, name, busy, dragging, aiHelped, route }: MovesPanelProps) {
  const reduced = useReducedMotion();
  const kind = step?.rig.kind ?? 'biped';
  const moves = movesFor(kind);
  const [picked, setMove] = useState<string | null>(null);
  // a new kind brings its own moves: the pick stays when the kind has it too
  const move = picked && moves.includes(picked) ? picked : firstMove(kind);

  const tweak = step?.rig.anims?.[move] ?? {};
  const amount = tweak.amount ?? 1;
  const speed = tweak.speed ?? 1;
  const drawRoute = route.name === 'bones' ? ({ name: 'draw', worldId: route.worldId, key: route.key } as const) : ({ name: 'drawFree', artId: route.artId } as const);

  return (
    <aside className="bones-side panel" aria-label={t('bones.sideLabel')}>
      <section className="bones-side__section" aria-labelledby="bones-watch-title">
        <div className="bones-side__head">
          <h2 id="bones-watch-title" className="bones-side__title">
            {t('bones.watchTitle', { name: midSentence(name) })}
          </h2>
          <span className="bones-side__sub">{t('bones.watchSub')}</span>
        </div>
        <MovePreview
          bound={bound}
          clip={move}
          tweak={{ amount, speed }}
          name={name}
          reduced={reduced}
          hold={dragging}
          emptyText={busy ? t('bones.statusFinding') : step ? '' : t('bones.previewEmpty')}
        />
      </section>
      <section className="bones-side__section" aria-labelledby="bones-moves-title">
        <div className="bones-side__head">
          <h2 id="bones-moves-title" className="bones-side__title">
            {t('bones.movesTitle')}
          </h2>
          <span className="bones-side__sub">{t('bones.movesSub')}</span>
        </div>
        <div className={cx('moves', moves.length > 8 && 'moves--nine')} role="group" aria-labelledby="bones-moves-title">
          {moves.map((m) => (
            <button key={m} type="button" className={cx('move-btn', m === move && 'move-btn--on')} aria-pressed={m === move} onClick={() => setMove(m)}>
              {moveWord(m)}
            </button>
          ))}
        </div>
      </section>
      <FeelSliders moveName={moveWord(move)} amount={amount} speed={speed} disabled={!step || busy} onChange={(which, v) => ctl.setTweak(move, { [which]: v }, which)} />
      <button type="button" className="draw-move" onClick={() => navigate(drawRoute)}>
        <Icon name="frame" size={22} />
        <span className="draw-move__text">
          <b>{t('bones.drawMove')}</b>
          <span>{t('bones.drawMoveHint', { move: moveWord(move) })}</span>
        </span>
      </button>
      <p className={cx('bones-local', aiHelped && 'bones-local--ai')}>
        <Icon name={aiHelped ? 'sparkle' : 'lock'} size={20} />
        <span>
          <b>{t('bones.localTitle')}</b> {aiHelped ? t('bones.localAiBody') : t('bones.localBody')}
        </span>
      </p>
    </aside>
  );
});
