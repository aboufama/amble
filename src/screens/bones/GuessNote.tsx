/**
 * Amble's guess (§2.11, `17-ref-bones-guess-note.png`): when Amble isn't sure (confidence below 0.6), a
 * note beside the drawing says why in words, in Amble's own voice ("The legs almost touch, so they
 * looked stuck together. I split them. If a knee is in the wrong place, drag it."). It goes away once
 * the student moves a star, and can be closed.
 */
import type { Fit } from '../../bones/geometry';
import { t } from '../../i18n';
import { Button } from '../../ui/components';
import { Icon } from '../../ui/icons';

const NOTE_W = 232;

/** Beside the drawing when there is room, else in the sky's top-right corner. */
function placeNote(fit: Fit, sky: { w: number; h: number }): { left?: number; right?: number; top: number } {
  const right = fit.ox + fit.w * fit.k + 28;
  return right + NOTE_W <= sky.w - 16 ? { left: right, top: Math.max(16, fit.oy + fit.h * fit.k * 0.36) } : { right: 16, top: 16 };
}

export function GuessNote({ reasons, fit, sky, onClose }: { reasons: string[]; fit: Fit; sky: { w: number; h: number }; onClose(): void }) {
  const style = placeNote(fit, sky);
  return (
    <aside className="guess-note" style={{ ...style, width: NOTE_W }} aria-labelledby="bones-guess-title" data-testid="bones-guess">
      <div className="guess-note__head">
        <h2 id="bones-guess-title" className="guess-note__title">
          {t('bones.guessTitle')}
        </h2>
        <button type="button" className="guess-note__close" aria-label={t('bones.guessClose')} onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {(reasons.length ? reasons : [t('bones.issueUnknown')]).map((r) => (
        <p key={r} className="guess-note__text">
          {r}
        </p>
      ))}
    </aside>
  );
}

/** The drawing changed a lot since its bones were placed (§7.9): offer Redo bones. */
export function RedoNote({ fit, sky, onRedo }: { fit: Fit; sky: { w: number; h: number }; onRedo(): void }) {
  return (
    <aside className="guess-note" style={{ ...placeNote(fit, sky), width: NOTE_W }} aria-labelledby="bones-stale-title" data-testid="bones-stale">
      <h2 id="bones-stale-title" className="guess-note__title">
        {t('bones.staleTitle')}
      </h2>
      <p className="guess-note__text">{t('bones.staleBody')}</p>
      <Button variant="ghost" size={44} icon="restart" className="guess-note__action" onClick={onRedo}>
        {t('bones.staleRedo')}
      </Button>
    </aside>
  );
}
