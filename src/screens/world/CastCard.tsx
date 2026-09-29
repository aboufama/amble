/**
 * One tile on the Cast line (§2.6), in the look of Scratch's sprite pane: a square white tile with the
 * drawing's picture, its name and its role. Drawn tiles carry a green check; the rest show their "just
 * bones" glyph and Draw me. The one Amble wants drawn next is the picked tile: Scratch's purple selection
 * edge and halo, a small orange "Your turn" tag and a blue Draw me. Optional, spare ("Room for Bubbles"),
 * resting ("Not in the game now") and Add someone tiles are quieter; NEW and ×3 are small tags.
 */
import { forwardRef } from 'react';
import { t, type MessageKey } from '../../i18n';
import type { CastMember, Pronoun } from '../../model/types';
import { PlaceholderGlyph, roleWord, Sticker } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { useSticker } from './hooks';

const PRONOUNS: Record<Pronoun, MessageKey> = { him: 'world.pronounHim', her: 'world.pronounHer', them: 'world.pronounThem', it: 'world.pronounIt' };

export function pronounWord(p: Pronoun): string {
  return t(PRONOUNS[p]);
}

/** What a screen reader hears for a tile. */
export function cardLabel(m: CastMember, turn = false): string {
  const role = roleWord(m.role);
  switch (m.status) {
    case 'drawn':
      return t('world.cardDrawn', { name: m.name, role });
    case 'needed':
      return turn ? t('world.cardTurn', { name: m.name, role }) : t('world.cardNeeded', { name: m.name, role });
    case 'optional':
      return t('world.cardOptional', { name: m.name, role });
    case 'spare':
      return t('world.cardSpare', { name: m.name, role });
    case 'resting':
      return t('world.cardResting', { name: m.name });
  }
}

export interface CastCardProps {
  member: CastMember;
  /** The tile Amble wants drawn next: Your turn, and a blue Draw me. */
  turn: boolean;
  /** Carries Scratch's selection edge and halo (the picked tile: your turn, the thing chosen in Change, an open menu). */
  picked: boolean;
  fresh: boolean;
  onPress(member: CastMember, el: HTMLElement): void;
}

export const CastCard = forwardRef<HTMLButtonElement, CastCardProps>(function CastCard({ member: m, turn, picked, fresh, onPress }, ref) {
  const sticker = useSticker(m.art);
  const drawn = m.status === 'drawn' || (m.status === 'resting' && !!m.art);
  const needed = m.status === 'needed';
  const count = m.count > 1 ? t('world.countTimes', { n: m.count }) : null;
  let sub: string;
  if (m.status === 'optional') sub = t('world.optional');
  else if (m.status === 'resting') sub = t('world.resting');
  else if (m.status === 'spare') sub = t('world.drawPronoun', { pronoun: pronounWord(m.pronoun) });
  else sub = roleWord(m.role);
  const name = m.status === 'spare' ? t('world.roomFor', { name: m.name }) : m.name;
  const yourTurn = turn && needed;
  return (
    <li className="cast-card__slot">
      <button
        ref={ref}
        type="button"
        className={cx('cast-card', `cast-card--${m.status}`, yourTurn && 'cast-card--turn', picked && 'cast-card--picked')}
        aria-label={cardLabel(m, yourTurn)}
        aria-haspopup={drawn ? 'menu' : undefined}
        data-testid={`cast-card-${m.key}`}
        data-status={m.status}
        onClick={(e) => onPress(m, e.currentTarget)}
      >
        {!yourTurn && (fresh || count) && (
          <span className={cx('cast-card__tag', fresh ? 'cast-card__tag--new' : 'cast-card__tag--count')} aria-hidden="true">
            {fresh ? t('world.newRibbon') : count}
          </span>
        )}
        {drawn && (
          <span className="cast-card__ok" aria-hidden="true">
            <Icon name="check" size={14} />
          </span>
        )}
        <span className="cast-card__body">
          {yourTurn && (
            <span className="cast-card__tag cast-card__tag--turn" aria-hidden="true">
              {t('world.yourTurn')}
            </span>
          )}
          <span className="cast-card__pic" aria-hidden="true">
            {drawn ? <Sticker src={sticker} alt="" size={54} className="cast-card__sticker" /> : <PlaceholderGlyph rig={m.rig} role={m.role} shape={m.shape} size={52} />}
          </span>
          <span className="cast-card__name">{name}</span>
          {needed ? (
            <span className={cx('cast-card__draw btn', yourTurn ? 'btn--lantern' : 'btn--paper')} aria-hidden="true">
              <Icon name="draw" size={14} />
              {t('world.drawMe')}
            </span>
          ) : (
            <span className="cast-card__sub">{sub}</span>
          )}
        </span>
      </button>
    </li>
  );
});

/** The dashed "Add someone" tile at the end of the line. */
export function AddCard({ onPress }: { onPress(el: HTMLElement): void }) {
  return (
    <li className="cast-card__slot">
      <button type="button" className="cast-card cast-card--add" aria-label={t('world.cardAdd')} data-testid="cast-add" onClick={(e) => onPress(e.currentTarget)}>
        <span className="cast-card__body">
          <span className="cast-card__pic" aria-hidden="true">
            <Icon name="plus" size={30} />
          </span>
          <span className="cast-card__name">{t('world.addSomeone')}</span>
          <span className="cast-card__sub">{t('world.friendOrFoe')}</span>
        </span>
      </button>
    </li>
  );
}
