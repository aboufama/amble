/**
 * The six kinds as pictograms (§3.4): Person, Four legs, Flies, Swims, Blob, Thing. Line art on the icon
 * grid, with the kind's word (shown, or as the image's name).
 */
import { t, type MessageKey } from '../../i18n';
import type { CharacterKind } from '../../model/types';
import { cx } from '../cx';

const PICTOS: Record<CharacterKind, string[]> = {
  biped: ['M12 3.2a2.3 2.3 0 1 0 .1 4.6 2.3 2.3 0 0 0-.1-4.6z', 'M12 8.2c.1 3.3.1 6.5 0 9.8', 'M12 10.2c-1.9 1.2-3.8 2.2-5.8 3', 'M12 10.2c1.9 1.2 3.8 2.2 5.8 3', 'M12 17.8c-1.3 1-2.4 2.1-3.4 3.2', 'M12 17.8c1.3 1 2.4 2.1 3.4 3.2'],
  quadruped: ['M5.2 10.2c3.9-.4 7.8-.4 11.6-.1l1.4-2.9c.4-.8 1.2-1.2 2-1 .9.2 1.4 1 1.3 1.9l-.4 2.6-2.8 1.7', 'M5.2 10.2c-.6 1.6-.6 3.1 0 4.6h12.1l1.8-2.4', 'M6.6 14.8c-.1 1.9-.1 3.7 0 5.6', 'M15.8 14.8c.1 1.9.1 3.7 0 5.6', 'M5.2 10.8c-.9-1-1.7-2.1-2.3-3.3'],
  flyer: ['M12 8.5c1.6 0 2.6 1.6 2.6 3.6 0 3.2-1.2 5.8-2.6 7.4-1.4-1.6-2.6-4.2-2.6-7.4 0-2 1-3.6 2.6-3.6z', 'M9.6 11.6c-2.5-1.6-4.7-3.8-6.4-6.6 3.2.4 5.3 1.5 6.7 3.2', 'M14.4 11.6c2.5-1.6 4.7-3.8 6.4-6.6-3.2.4-5.3 1.5-6.7 3.2'],
  swimmer: ['M6.4 12c2.4-3 5.5-4.5 9.2-4.5 2.4 0 4.4 1.3 5.8 4.5-1.4 3.2-3.4 4.5-5.8 4.5-3.7 0-6.8-1.5-9.2-4.5z', 'M6.4 12L2.6 8.8c.1 2.1.1 4.3 0 6.4z'],
  blob: ['M4.6 19.4C4.2 11.7 7.6 4.6 12 4.6s7.8 7.1 7.4 14.8c-4.9.9-9.9.9-14.8 0z'],
  object: ['M5 7.6l7-3.4 7 3.4v8.8l-7 3.4-7-3.4z', 'M5 7.6l7 3.4 7-3.4', 'M12 11c.1 2.9.1 5.9 0 8.8'],
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
