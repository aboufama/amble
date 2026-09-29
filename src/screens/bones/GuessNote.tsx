/**
 * Amble's guess (§2.11, `17-ref-bones-guess-note.png`): when Amble isn't sure (confidence below 0.6), a
 * note beside the drawing says why in words, in Amble's own voice ("The legs almost touch, so they
 * looked stuck together. I split them. If a knee is in the wrong place, drag it."). It goes away once
 * the student moves a star, and can be closed.
 */
import type { Fit } from '../../bones/geometry';
import { t } from '../../i18n';
import { Icon } from '../../ui/icons';

const NOTE_W = 232;

export function GuessNote({ reasons, fit, sky, onClose }: { reasons: string[]; fit: Fit; sky: { w: number; h: number }; onClose(): void }) {
  const right = fit.ox + fit.w * fit.k + 28;
  const beside = right + NOTE_W <= sky.w - 16;
  const style = beside
    ? { left: right, top: Math.max(16, fit.oy + fit.h * fit.k * 0.36) }
    : { right: 16, top: 16 };
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
