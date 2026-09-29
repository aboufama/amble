/**
 * A world card (§2.3, §2.5): the world type's scene with the student's character standing in it, its
 * name and one line about it. As a starter card ("Or play one first."), it shows the starter's sign.
 * Cards are real buttons (or radios on the New world sheet).
 */
import type { CSSProperties } from 'react';
import { t } from '../../i18n';
import type { PoseImage } from '../../home/seedThumbs';
import type { StarterId, StarterInfo } from '../../model/types';
import { cx } from '../../ui/cx';
import { SeedScene } from './SeedScene';
import './cards.css';

export interface SeedCardProps {
  seed: StarterId;
  info: StarterInfo;
  /** 'seed': a world type with the student's hero; 'starter': a starter world to play. */
  kind: 'seed' | 'starter';
  pose?: PoseImage | null;
  heroName?: string | null;
  /** Radio semantics (the New world sheet) with this checked state; otherwise a plain button. */
  checked?: boolean;
  radio?: boolean;
  /** A ribbon across the corner ("From your teacher"). */
  ribbon?: string | null;
  busy?: boolean;
  disabled?: boolean;
  tabIndex?: number;
  className?: string;
  style?: CSSProperties;
  onPick(): void;
  onKeyDown?(e: React.KeyboardEvent<HTMLButtonElement>): void;
  cardRef?: (el: HTMLButtonElement | null) => void;
}

export function SeedCard({ seed, info, kind, pose = null, heroName = null, checked, radio, ribbon, busy, disabled, tabIndex, className, style, onPick, onKeyDown, cardRef }: SeedCardProps) {
  const title = kind === 'starter' ? info.title : info.genre;
  const line = kind === 'starter' ? info.genre : info.blurb;
  const label =
    kind === 'starter'
      ? t('home.starterCard', { title: info.title, genre: info.genre })
      : heroName
        ? t('home.seedCard', { genre: info.genre, name: heroName, blurb: info.blurb })
        : t('home.seedCardNoHero', { genre: info.genre, blurb: info.blurb });
  return (
    <button
      ref={cardRef}
      type="button"
      className={cx('seed-card', 'on-paper', `seed-card--${kind}`, checked && 'seed-card--checked', busy && 'seed-card--busy', className)}
      style={style}
      role={radio ? 'radio' : undefined}
      aria-checked={radio ? Boolean(checked) : undefined}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled}
      tabIndex={tabIndex}
      data-seed={seed}
      onClick={onPick}
      onKeyDown={onKeyDown}
    >
      <span className="seed-card__thumb">
        {kind === 'starter' && info.sign ? <img src={info.sign} alt="" draggable={false} /> : <SeedScene seed={seed} pose={kind === 'seed' ? pose : null} ghosts={kind === 'seed'} />}
      </span>
      <span className="seed-card__title">{title}</span>
      <span className="seed-card__line">{line}</span>
      {ribbon && <span className="seed-card__ribbon">{ribbon}</span>}
    </button>
  );
}
