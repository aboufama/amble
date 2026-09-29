/**
 * The six kinds as pictograms (§3.4): Person, Four legs, Flies, Swims, Blob, Thing. Clean line art on the
 * 24 px icon grid (2 px strokes, round caps and joins), with the kind's word (shown, or as the image's name).
 */
import { t, type MessageKey } from '../../i18n';
import type { CharacterKind } from '../../model/types';
import { cx } from '../cx';

const PICTOS: Record<CharacterKind, string[]> = {
  biped: ['M12 3a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z', 'M12 8v7', 'M6.5 12L12 10l5.5 2', 'M8.5 21l3.5-6 3.5 6'],
  quadruped: ['M6 10.5h8a2.5 2.5 0 0 1 0 5H6a2.5 2.5 0 0 1 0-5z', 'M17.5 6a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z', 'M6.5 15.5V20', 'M13.5 15.5V20', 'M3.8 12L2 9.5'],
  flyer: ['M12 13C10 9 6.5 6.5 2.5 6.5c1 4 4.5 7 9.5 6.5z', 'M12 13c2-4 5.5-6.5 9.5-6.5-1 4-4.5 7-9.5 6.5z', 'M12 11v8'],
  swimmer: ['M5 12c2.2-3.2 5-4.8 8.5-4.8S19.8 9 21 12c-1.2 3-4 4.8-7.5 4.8S7.2 15.2 5 12z', 'M5 12L2 8.8v6.4z', 'M16.5 11h.01'],
  blob: ['M4.5 19.5c-.6-7 2.6-14 7.5-14s8.1 7 7.5 14c-5 .8-10 .8-15 0z'],
  object: ['M12 3.5l8 4v9l-8 4-8-4v-9z', 'M4 7.5l8 4 8-4', 'M12 11.5v9'],
};

const WORDS: Record<CharacterKind, MessageKey> = {
  biped: 'common.kindBiped',
  quadruped: 'common.kindQuadruped',
  flyer: 'common.kindFlyer',
  swimmer: 'common.kindSwimmer',
  blob: 'common.kindBlob',
  object: 'common.kindObject',
};

export function kindWord(kind: CharacterKind): string {
  return t(WORDS[kind]);
}

export function KindIcon({ kind, size = 24, showLabel = false, className }: { kind: CharacterKind; size?: number; showLabel?: boolean; className?: string }) {
  const svg = (
    <svg
      className="kind-icon__img"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size <= 16 ? 2.4 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={showLabel ? undefined : 'img'}
      aria-label={showLabel ? undefined : kindWord(kind)}
      aria-hidden={showLabel ? true : undefined}
      focusable="false"
    >
      {PICTOS[kind].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
  if (!showLabel) return svg;
  return (
    <span className={cx('kind-icon', className)}>
      {svg}
      <span>{kindWord(kind)}</span>
    </span>
  );
}
