/**
 * The lamppost (§2.4): its lantern lights a spot on the path. With no characters yet it lights a dashed
 * star-figure and the garden sign **YOUR CHARACTER / goes here ✎** (and breathes, 3.2 s); for returning
 * students their newest character stands there, idling. A drawing brought to life on the Desk lands here
 * (the come-alive flight), then **"Give {name} a world."** appears beside it.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Link } from '../../app/Link';
import { t } from '../../i18n';
import type { ArtId } from '../../model/types';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';

export interface LampSpotProps {
  /** Stop's left edge and the lit spot's centre, content px. */
  x: number;
  cx: number;
  /** The spot's feet line, design px. */
  feet: number;
  empty: boolean;
  breathing: boolean;
  /** The newest character, standing in the light. */
  character?: ReactNode;
  /** After a landing: the character to give a world to. */
  give?: { id: ArtId; name: string } | null;
  lit: boolean;
}

/** The dashed "draw me" figure: bones (a constellation) and an outline, no body yet (§3.8). */
function WaitingFigure() {
  return (
    <svg className="lamp__figure" width="110" height="140" viewBox="-55 -134 110 140" aria-hidden="true" focusable="false">
      <g className="lamp__ph-halo">
        <ellipse cx="0" cy="-118" rx="22" ry="21" />
        <path d="M-17 -95 Q-21 -60 -15 -37 L15 -37 Q21 -60 17 -95 Z" />
        <path d="M-22 -90 L-46 -60" />
        <path d="M22 -90 L46 -64" />
        <path d="M-10 -37 L-13 -2" />
        <path d="M10 -37 L13 -2" />
      </g>
      <g className="lamp__ph-body">
        <ellipse cx="0" cy="-118" rx="22" ry="21" />
        <path d="M-17 -95 Q-21 -60 -15 -37 L15 -37 Q21 -60 17 -95 Z" />
        <path d="M-25 -92 L-49 -61 M-13 -87 L-37 -56" />
        <path d="M25 -92 L49 -65 M13 -87 L37 -61" />
        <path d="M-17 -37 L-20 -2 M-4 -37 L-7 -2" />
        <path d="M4 -37 L7 -2 M17 -37 L20 -2" />
      </g>
      <path className="lamp__ph-bone" d="M0 -99 L0 -41 M0 -89 L-40 -59 M0 -89 L40 -63 M0 -41 L-12 -3 M0 -41 L12 -3 M0 -99 L0 -128" />
      <g className="lamp__ph-joint">
        <circle cx="0" cy="-99" r="3.3" />
        <circle cx="0" cy="-41" r="3.3" />
        <circle cx="-40" cy="-59" r="2.9" />
        <circle cx="40" cy="-63" r="2.9" />
        <circle cx="-12" cy="-3" r="2.9" />
        <circle cx="12" cy="-3" r="2.9" />
        <circle cx="0" cy="-128" r="2.9" />
        <circle cx="0" cy="-89" r="2.6" />
      </g>
    </svg>
  );
}

export function LampSpot({ x, cx: spot, feet, empty, breathing, character, give, lit }: LampSpotProps) {
  const post = spot - 64;
  const style = { left: x, top: `calc(100% - 768px + ${feet - 262}px)`, ['--post' as string]: `${post - x}px`, ['--spot' as string]: `${spot - x}px` } as CSSProperties;
  return (
    <div className={cx('trail-stop', 'lamp', breathing && 'lamp--breathing', lit && 'lamp--lit')} style={style} data-testid="lamp-spot">
      <svg className="lamp__post" width="380" height="270" viewBox="0 0 380 270" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="lamp-cone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="lamp__cone-a" />
            <stop offset="1" className="lamp__cone-b" />
          </linearGradient>
          <radialGradient id="lamp-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" className="lamp__glow-a" />
            <stop offset="1" className="lamp__glow-b" />
          </radialGradient>
        </defs>
        <g transform={`translate(${post - x} 0)`}>
          <polygon className="lamp__cone" points="54,36 76,36 184,266 -56,266" fill="url(#lamp-cone)" />
          <path className="lamp__pole" d="M0 258 L0 18 Q0 6 12 6 L64 6" />
          <path className="lamp__pole-hi" d="M0 258 L0 18 Q0 6 12 6 L64 6" />
          <path className="lamp__pole" d="M64 6 L64 14" />
          <circle className="lamp__glow" cx="65" cy="28" r="42" fill="url(#lamp-glow)" />
          <rect className="lamp__lantern" x="54" y="14" width="22" height="28" rx="7" />
          <rect className="lamp__light" x="59" y="19" width="12" height="18" rx="4" />
        </g>
      </svg>
      {empty ? (
        <>
          <span className="lamp__spot">
            <WaitingFigure />
          </span>
          <Link to={{ name: 'first' }} className="lamp__garden on-paper" aria-label={t('home.lampEmpty')}>
            <span className="lamp__garden-card">
              <b>{t('home.yourCharacter')}</b>
              <span>
                {t('home.goesHere')} <Icon name="draw" size={17} />
              </span>
            </span>
            <span className="lamp__garden-stick" aria-hidden="true" />
          </Link>
        </>
      ) : (
        character
      )}
      {give && (
        <Link to={{ name: 'new', hero: give.id, idea: false }} className="lamp__give btn btn--lantern btn--h44" data-testid="give-world">
          <Icon name="sparkle" size={20} />
          <span className="btn__label">{t('home.giveNameWorld', { name: give.name })}</span>
        </Link>
      )}
    </div>
  );
}
