/**
 * The lamppost (§2.4): a flat post with its lamp over a spot on the path. With no characters yet a dashed
 * figure waits there with the garden sign **Your character / goes here ✎**; for returning students their
 * newest character stands there, idling. A drawing brought to life on the Desk lands here (the come-alive
 * flight), then **"Give {name} a world."** appears beside it.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Link } from '../../app/Link';
import { t } from '../../i18n';
import type { ArtId } from '../../model/types';
import { Icon } from '../../ui/icons';

export interface LampSpotProps {
  /** Stop's left edge and the lit spot's centre, content px. */
  x: number;
  cx: number;
  /** The spot's feet line, design px. */
  feet: number;
  empty: boolean;
  /** The newest character, standing in the light. */
  character?: ReactNode;
  /** After a landing: the character to give a world to. */
  give?: { id: ArtId; name: string } | null;
}

/** The dashed "draw me" figure: bones and an outline, no body yet (§3.8). */
function WaitingFigure() {
  return (
    <svg className="lamp__figure" width="110" height="140" viewBox="-55 -134 110 140" aria-hidden="true" focusable="false">
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

export function LampSpot({ x, cx: spot, feet, empty, character, give }: LampSpotProps) {
  const post = spot - 64;
  const style = { left: x, top: `calc(100% - 768px + ${feet - 262}px)`, ['--post' as string]: `${post - x}px`, ['--spot' as string]: `${spot - x}px` } as CSSProperties;
  return (
    <div className="trail-stop lamp" style={style} data-testid="lamp-spot">
      <svg className="lamp__post" width="380" height="270" viewBox="0 0 380 270" aria-hidden="true" focusable="false">
        <g transform={`translate(${post - x} 0)`}>
          <rect className="lamp__foot" x="-9" y="250" width="18" height="8" rx="2" />
          <path className="lamp__pole" d="M0 252 L0 18 Q0 6 12 6 L64 6" />
          <path className="lamp__pole" d="M64 6 L64 14" />
          <rect className="lamp__lantern" x="53" y="14" width="23" height="28" rx="4" />
          <rect className="lamp__light" x="58" y="19" width="13" height="17" rx="2" />
          <path className="lamp__cap" d="M50 14 H79" />
        </g>
      </svg>
      {empty ? (
        <>
          <span className="lamp__spot">
            <WaitingFigure />
          </span>
          <Link to={{ name: 'first' }} className="lamp__garden" aria-label={t('home.lampEmpty')}>
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
          <Icon name="plus" size={20} />
          <span className="btn__label">{t('home.giveNameWorld', { name: give.name })}</span>
        </Link>
      )}
    </div>
  );
}
