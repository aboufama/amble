/**
 * One card on the Cast line (§2.6): drawn (sticker, name, role, ✓), needed (its "just bones" glyph and
 * ✎ Draw me; the most wanted one glows), your turn, optional, spare ("Room for Bubbles"), resting ("Not in
 * the game now"), with NEW and ×3 when they apply. Cards hang from the string at a slight tilt.
 */
import { forwardRef } from 'react';
import { t, type MessageKey } from '../../i18n';
import type { CastMember, Pronoun } from '../../model/types';
import { PlaceholderGlyph, roleWord, Sticker } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { useSticker } from './hooks';

const TILTS = [-1.2, 1, -0.6, 1.1, -0.8, 0.6, -1, 0.9];

export function tiltOf(index: number): number {
  return TILTS[index % TILTS.length];
}

const PRONOUNS: Record<Pronoun, MessageKey> = { him: 'world.pronounHim', her: 'world.pronounHer', them: 'world.pronounThem', it: 'world.pronounIt' };

export function pronounWord(p: Pronoun): string {
  return t(PRONOUNS[p]);
}

/** What a screen reader hears for a card. */
export function cardLabel(m: CastMember): string {
  const role = roleWord(m.role);
  switch (m.status) {
    case 'drawn':
      return t('world.cardDrawn', { name: m.name, role });
    case 'needed':
      return t('world.cardNeeded', { name: m.name, role });
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
  index: number;
  /** The one needed card that glows (the highest priority). */
  glow: boolean;
  yourTurn: boolean;
  fresh: boolean;
  selected: boolean;
  onPress(member: CastMember, el: HTMLElement): void;
}

export const CastCard = forwardRef<HTMLButtonElement, CastCardProps>(function CastCard({ member: m, index, glow, yourTurn, fresh, selected, onPress }, ref) {
  const sticker = useSticker(m.art);
  const drawn = m.status === 'drawn' || (m.status === 'resting' && !!m.art);
  const count = m.count > 1 ? t('world.countTimes', { n: m.count }) : null;
  let sub: string;
  if (m.status === 'optional') sub = t('world.optional');
  else if (m.status === 'resting') sub = t('world.resting');
  else if (m.status === 'spare') sub = t('world.drawPronoun', { pronoun: pronounWord(m.pronoun) });
  else sub = roleWord(m.role);
  const name = m.status === 'spare' ? t('world.roomFor', { name: m.name }) : m.name;
  return (
    <li className="cast-card__slot" style={{ ['--tilt' as string]: `${tiltOf(index)}deg` }}>
      <button
        ref={ref}
        type="button"
        className={cx('cast-card', `cast-card--${m.status}`, glow && 'cast-card--glow', selected && 'cast-card--selected')}
        aria-label={cardLabel(m)}
        aria-haspopup={drawn ? 'menu' : undefined}
        data-testid={`cast-card-${m.key}`}
        data-status={m.status}
        onClick={(e) => onPress(m, e.currentTarget)}
      >
        <span className="cast-card__pin" aria-hidden="true" />
        {drawn && (
          <span className="cast-card__ok" aria-hidden="true">
            <Icon name="check" size={14} />
          </span>
        )}
        {yourTurn && m.status === 'needed' && <span className="cast-card__ribbon">{t('world.yourTurn')}</span>}
        {fresh && <span className="cast-card__ribbon cast-card__ribbon--new">{t('world.newRibbon')}</span>}
        {count && <span className="cast-card__count">{count}</span>}
        <span className="cast-card__pic" aria-hidden="true">
          {drawn ? <Sticker src={sticker} alt="" size={54} className="cast-card__sticker" /> : <PlaceholderGlyph rig={m.rig} role={m.role} shape={m.shape} size={56} />}
        </span>
        <span className="cast-card__name">{name}</span>
        {m.status === 'needed' ? (
          <span className={cx('cast-card__draw', glow ? 'btn btn--lantern' : 'btn btn--paper')} aria-hidden="true">
            <Icon name="draw" size={15} />
            {t('world.drawMe')}
          </span>
        ) : (
          <span className="cast-card__sub">{sub}</span>
        )}
      </button>
    </li>
  );
});

/** The dashed "Add someone" card at the end of the line. */
export function AddCard({ index, onPress }: { index: number; onPress(el: HTMLElement): void }) {
  return (
    <li className="cast-card__slot" style={{ ['--tilt' as string]: `${tiltOf(index)}deg` }}>
      <button type="button" className="cast-card cast-card--add" aria-label={t('world.cardAdd')} data-testid="cast-add" onClick={(e) => onPress(e.currentTarget)}>
        <span className="cast-card__pin" aria-hidden="true" />
        <span className="cast-card__pic" aria-hidden="true">
          <Icon name="plus" size={34} />
        </span>
        <span className="cast-card__name">{t('world.addSomeone')}</span>
        <span className="cast-card__sub">{t('world.friendOrFoe')}</span>
      </button>
    </li>
  );
}
