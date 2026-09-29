/**
 * A "just bones" member as an SVG (§3.8) for cards, the plan card and the gallery, drawn flat: the rig
 * template's silhouette in its role tint at 55 %, white hatching at 38°, a flat dashed outline (--dash)
 * and the bones with round joints. Never eyes, faces, shading or texture. (The game's own stand-ins are
 * drawn by the runtime.)
 */
import { useId } from 'react';
import { t } from '../../i18n';
import type { ArtShape, RigKind, Role } from '../../model/types';
import { cx } from '../cx';

export type GlyphRole = Role | 'friend';

type Seg = [number, number, number, number];

interface Figure {
  /** Closed outlines (viewBox 0..100). */
  outline: string[];
  bones: Seg[];
}

const FIGURES: Record<Exclude<RigKind, 'object' | 'none'>, Figure> = {
  biped: {
    outline: [
      'M50 6a11 11 0 1 0 .1 22 11 11 0 0 0-.1-22z',
      'M40 32Q50 29 60 32L73 52Q75 57 70 58L62 47 61 60 64 92Q64 96 59 96L55 96 51 66 49 66 45 96 41 96Q36 96 36 92L39 60 38 47 30 58Q25 57 27 52Z',
    ],
    bones: [
      [50, 17, 50, 33],
      [50, 33, 50, 60],
      [50, 36, 36, 46],
      [36, 46, 29, 55],
      [50, 36, 64, 46],
      [64, 46, 71, 55],
      [50, 60, 44, 78],
      [44, 78, 43, 93],
      [50, 60, 56, 78],
      [56, 78, 57, 93],
    ],
  },
  blob: {
    outline: ['M16 94C14 56 28 20 50 20S86 56 84 94Q50 99 16 94Z'],
    bones: [
      [50, 92, 50, 56],
      [50, 56, 50, 26],
    ],
  },
  quadruped: {
    outline: [
      'M16 44Q18 34 30 34L66 34Q72 34 75 29L80 21Q84 15 90 17Q97 20 95 28L93 35Q90 41 82 43L80 56 80 90Q80 94 76 94L73 94 71 60 37 60 35 94 30 94Q27 94 27 90L27 58Q19 54 17 49L7 45Q4 43 7 40Z',
    ],
    bones: [
      [30, 45, 70, 41],
      [70, 41, 84, 26],
      [72, 45, 76, 74],
      [76, 74, 76, 91],
      [32, 47, 31, 74],
      [31, 74, 31, 91],
      [26, 45, 10, 42],
    ],
  },
  flyer: {
    outline: ['M50 14a9 9 0 1 0 .1 18 9 9 0 0 0-.1-18z', 'M50 32C58 32 62 41 62 50L91 36Q97 35 94 42L62 64C60 76 56 84 50 88 44 84 40 76 38 64L6 42Q3 35 9 36L38 50C38 41 42 32 50 32Z'],
    bones: [
      [50, 84, 50, 44],
      [50, 44, 50, 23],
      [46, 50, 24, 46],
      [24, 46, 9, 40],
      [54, 50, 76, 46],
      [76, 46, 91, 40],
    ],
  },
  swimmer: {
    outline: ['M24 42C36 30 62 28 80 38Q94 46 94 50T80 62C62 72 36 70 24 58L7 69Q3 70 4 66L12 50 4 34Q3 30 7 31Z'],
    bones: [
      [86, 50, 62, 50],
      [62, 50, 40, 52],
      [40, 52, 16, 50],
    ],
  },
};

const SHAPES: Record<ArtShape, string> = {
  box: 'M16 18L84 18 84 90 16 90Z',
  ellipse: 'M50 16C73 16 88 34 88 54S73 92 50 92 12 74 12 54 27 16 50 16Z',
  capsule: 'M36 10H64Q80 10 80 26V74Q80 92 64 92H36Q20 92 20 74V26Q20 10 36 10Z',
  diamond: 'M50 8L88 52 50 94 12 52Z',
  star: 'M50 8L61 38 93 38 67 57 77 88 50 69 23 88 33 57 7 38 39 38Z',
  heart: 'M50 88C20 66 10 48 10 34 10 20 21 12 32 12 41 12 47 18 50 25 53 18 59 12 68 12 79 12 90 20 90 34 90 48 80 66 50 88Z',
  coin: 'M50 10a40 40 0 1 0 .1 80 40 40 0 0 0-.1-80zM50 26a24 24 0 1 1-.1 48 24 24 0 0 1 .1-48z',
  tile: 'M10 30L90 30 90 74 10 74Z',
};

function figureOf(rig: RigKind, shape: ArtShape): Figure {
  if (rig === 'object' || rig === 'none') return { outline: [SHAPES[shape]], bones: rig === 'object' ? [[50, 88, 50, 18]] : [] };
  return FIGURES[rig];
}

function tintOf(role: GlyphRole): string {
  if (role === 'enemyShot') return 'projectile';
  if (role === 'background') return 'decor';
  return role;
}

export interface PlaceholderGlyphProps {
  rig: RigKind;
  role: GlyphRole;
  /** The outline for members without bones (items, props). */
  shape?: ArtShape;
  size?: number;
  /** The member's name: the glyph is then an image named "{name}, just bones". */
  name?: string;
  className?: string;
}

export function PlaceholderGlyph({ rig, role, shape = 'capsule', size = 64, name, className }: PlaceholderGlyphProps) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '');
  const hatch = `ph-hatch-${raw}`;
  const clip = `ph-clip-${raw}`;
  const fig = figureOf(rig, shape);
  const joints = new Map<string, [number, number]>();
  for (const [x1, y1, x2, y2] of fig.bones) {
    joints.set(`${x1},${y1}`, [x1, y1]);
    joints.set(`${x2},${y2}`, [x2, y2]);
  }
  return (
    <svg
      className={cx('ph-glyph', `tint-${tintOf(role)}`, className)}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={name ? 'img' : undefined}
      aria-label={name ? t('common.justBones', { name }) : undefined}
      aria-hidden={name ? undefined : true}
      focusable="false"
    >
      <defs>
        <pattern id={hatch} patternUnits="userSpaceOnUse" width="9" height="9" patternTransform="rotate(38)">
          <line className="ph-glyph__hatch" x1="0" y1="0" x2="0" y2="9" />
        </pattern>
        <clipPath id={clip}>
          {fig.outline.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </clipPath>
      </defs>
      {fig.outline.map((d, i) => (
        <path key={`f${i}`} className="ph-glyph__fill" d={d} />
      ))}
      <rect x="0" y="0" width="100" height="100" fill={`url(#${hatch})`} clipPath={`url(#${clip})`} className="ph-glyph__hatches" />
      {fig.outline.map((d, i) => (
        <path key={`d${i}`} className="ph-glyph__dash" d={d} />
      ))}
      <g className="ph-glyph__bones">
        {fig.bones.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
        {[...joints.values()].map(([x, y]) => (
          <circle key={`${x},${y}`} className="ph-glyph__joint" cx={x} cy={y} r={3} />
        ))}
      </g>
    </svg>
  );
}
