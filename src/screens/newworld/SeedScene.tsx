/**
 * A world type's scene (§2.3, §2.5): the game's plain scenery for each seed, the members the student
 * hasn't drawn yet as just bones (§3.8), and the student's own character standing in the hero's spot.
 * One SVG in scene units (320x180), sliced to fill any card, so the character and the scenery scale
 * together. Scenery colours are the games' own (games are not themed).
 */
import type { ReactNode } from 'react';
import { heroRect, HERO_SPOTS, type PoseImage } from '../../home/seedThumbs';
import type { ArtShape, RigKind, StarterId } from '../../model/types';
import { PlaceholderGlyph, type GlyphRole } from '../../ui/components';
import { cx } from '../../ui/cx';

const W = 320;
const H = 180;

interface Ghost {
  rig: RigKind;
  role: GlyphRole;
  shape?: ArtShape;
  /** Centre x, feet y and size, in scene px. */
  x: number;
  y: number;
  size: number;
}

interface SceneDef {
  paint: ReactNode;
  cast: Ghost[];
}

function Stars({ at }: { at: Array<[number, number, number]> }) {
  return (
    <g fill="#f4ecdc">
      {at.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} opacity={0.35 + (i % 3) * 0.2} />
      ))}
    </g>
  );
}

const SCENES: Record<StarterId, SceneDef> = {
  'moon-king': {
    paint: (
      <>
        <defs>
          <linearGradient id="ss-mk-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#15174a" />
            <stop offset="1" stopColor="#2d2a78" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill="url(#ss-mk-sky)" />
        <Stars at={[[30, 24, 1.2], [88, 14, 1], [140, 34, 1.3], [196, 16, 1], [300, 30, 1.2], [260, 58, 0.9], [60, 60, 1]]} />
        <path d="M44 20a15 15 0 1 0 9 27a12 12 0 1 1 -9 -27z" fill="#fff1c9" opacity=".9" />
        <rect x="138" y="74" width="62" height="9" rx="4.5" fill="#15133a" />
        <rect x="138" y="74" width="62" height="3" rx="1.5" fill="#a993ee" opacity=".8" />
        <path d="M0 146c50-8 110-6 160-2s120 6 160-4v40H0z" fill="#b9b2dd" />
        <path d="M0 146c50-8 110-6 160-2s120 6 160-4" fill="none" stroke="#e6e0ff" strokeWidth="2" opacity=".7" />
        <g fill="#9d95c9">
          <ellipse cx="122" cy="160" rx="14" ry="4" />
          <ellipse cx="248" cy="164" rx="10" ry="3" />
          <ellipse cx="40" cy="168" rx="9" ry="3" />
        </g>
      </>
    ),
    cast: [
      { rig: 'blob', role: 'boss', x: 246, y: 142, size: 92 },
      { rig: 'blob', role: 'enemy', x: 166, y: 144, size: 26 },
      { rig: 'object', role: 'item', shape: 'star', x: 170, y: 64, size: 18 },
    ],
  },
  'sky-run': {
    paint: (
      <>
        <defs>
          <linearGradient id="ss-sr-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff9f7a" />
            <stop offset="0.55" stopColor="#b86fb8" />
            <stop offset="1" stopColor="#5c4fb0" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill="url(#ss-sr-sky)" />
        <circle cx="262" cy="46" r="18" fill="#ffd9a0" opacity=".55" />
        <g fill="#fff" opacity=".35">
          <ellipse cx="70" cy="44" rx="30" ry="7" />
          <ellipse cx="200" cy="30" rx="22" ry="5" />
        </g>
        {[
          [12, 118, 100],
          [148, 104, 70],
          [252, 126, 80],
        ].map(([x, y, w]) => (
          <g key={x}>
            <rect x={x} y={y} width={w} height="13" rx="6.5" fill="#2b2750" />
            <rect x={x} y={y} width={w} height="4" rx="2" fill="#7fd67a" />
          </g>
        ))}
        <path d="M0 176h320v4H0z" fill="#4a3f96" />
      </>
    ),
    cast: [
      { rig: 'object', role: 'item', shape: 'coin', x: 136, y: 76, size: 14 },
      { rig: 'object', role: 'item', shape: 'coin', x: 156, y: 66, size: 14 },
      { rig: 'object', role: 'item', shape: 'coin', x: 176, y: 72, size: 14 },
      { rig: 'blob', role: 'enemy', x: 286, y: 126, size: 26 },
    ],
  },
  'clanks-climb': {
    paint: (
      <>
        <defs>
          <linearGradient id="ss-cc-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2c2166" />
            <stop offset="1" stopColor="#6a3f9a" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill="url(#ss-cc-sky)" />
        <Stars at={[[40, 20, 1], [120, 12, 1.2], [300, 18, 1], [210, 40, 0.9]]} />
        {[
          [22, 112, 110],
          [150, 80, 82],
          [232, 46, 72],
        ].map(([x, y, w]) => (
          <g key={x}>
            <rect x={x} y={y} width={w} height="10" rx="5" fill="#1f1840" />
            <rect x={x} y={y} width={w} height="3.5" rx="1.75" fill="#c79bff" />
          </g>
        ))}
        <path d="M0 154c20-6 40 6 60 0s40-6 60 0 40 6 60 0 40-6 60 0 40 6 60 0 20-4 20-4v34H0z" fill="#58c97a" opacity=".85" />
        <path d="M0 154c20-6 40 6 60 0s40-6 60 0 40 6 60 0 40-6 60 0 40 6 60 0 20-4 20-4" fill="none" stroke="#b7f7c8" strokeWidth="2" opacity=".7" />
      </>
    ),
    cast: [
      { rig: 'quadruped', role: 'enemy', x: 196, y: 80, size: 30 },
      { rig: 'object', role: 'prop', shape: 'capsule', x: 282, y: 46, size: 34 },
      { rig: 'object', role: 'item', shape: 'coin', x: 128, y: 96, size: 13 },
    ],
  },
  'lantern-maze': {
    paint: (
      <>
        <rect width={W} height={H} fill="#16301f" />
        <g fill="#2e6b3e">
          <rect x="8" y="10" width="304" height="12" rx="6" />
          <rect x="8" y="158" width="304" height="12" rx="6" />
          <rect x="8" y="10" width="12" height="160" rx="6" />
          <rect x="300" y="10" width="12" height="160" rx="6" />
          <rect x="54" y="48" width="96" height="12" rx="6" />
          <rect x="188" y="48" width="12" height="70" rx="6" />
          <rect x="230" y="88" width="70" height="12" rx="6" />
          <rect x="54" y="96" width="12" height="44" rx="6" />
          <rect x="108" y="92" width="52" height="12" rx="6" />
        </g>
        <g fill="#4d9a5e" opacity=".65">
          <rect x="54" y="48" width="96" height="4" rx="2" />
          <rect x="230" y="88" width="70" height="4" rx="2" />
          <rect x="108" y="92" width="52" height="4" rx="2" />
          <rect x="8" y="10" width="304" height="4" rx="2" />
        </g>
        <circle cx="258" cy="56" r="26" fill="#ffc15e" opacity=".22" />
        <circle cx="258" cy="56" r="12" fill="#ffc15e" opacity=".3" />
      </>
    ),
    cast: [
      { rig: 'object', role: 'item', shape: 'capsule', x: 258, y: 66, size: 20 },
      { rig: 'blob', role: 'enemy', x: 224, y: 146, size: 34 },
      { rig: 'object', role: 'item', shape: 'diamond', x: 86, y: 38, size: 14 },
    ],
  },
  'wobble-tower': {
    paint: (
      <>
        <defs>
          <linearGradient id="ss-wt-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#173550" />
            <stop offset="1" stopColor="#2c6c74" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill="url(#ss-wt-sky)" />
        <g fill="#122a3d">
          <rect x="10" y="84" width="34" height="70" />
          <rect x="48" y="102" width="26" height="52" />
          <rect x="262" y="76" width="40" height="78" />
          <rect x="226" y="108" width="30" height="46" />
          <rect x="120" y="96" width="30" height="58" />
        </g>
        <g fill="#ffcf82" opacity=".75">
          <rect x="18" y="94" width="5" height="6" />
          <rect x="30" y="112" width="5" height="6" />
          <rect x="272" y="88" width="5" height="6" />
          <rect x="286" y="108" width="5" height="6" />
          <rect x="128" y="106" width="5" height="6" />
          <rect x="234" y="118" width="5" height="6" />
        </g>
        <rect x="0" y="146" width={W} height="34" fill="#1b2b3a" />
        <rect x="0" y="146" width={W} height="3" fill="#3d6d78" />
      </>
    ),
    cast: [
      { rig: 'object', role: 'prop', shape: 'box', x: 184, y: 147, size: 34 },
      { rig: 'object', role: 'prop', shape: 'box', x: 218, y: 147, size: 34 },
      { rig: 'object', role: 'prop', shape: 'box', x: 201, y: 116, size: 32 },
      { rig: 'object', role: 'prop', shape: 'ellipse', x: 282, y: 147, size: 24 },
      { rig: 'biped', role: 'npc', x: 146, y: 147, size: 40 },
    ],
  },
};

export interface SeedSceneProps {
  seed: StarterId;
  /** The student's character, posed; null shows the scenery with the rest of the cast only. */
  pose: PoseImage | null;
  /** Show the other members as just bones (seeds: yes; a starter's scenery-only stand-in: no). */
  ghosts?: boolean;
  className?: string;
}

export function SeedScene({ seed, pose, ghosts = true, className }: SeedSceneProps) {
  const scene = SCENES[seed];
  const hero = pose ? heroRect(HERO_SPOTS[seed], pose, W, H) : null;
  return (
    <svg className={cx('seed-scene', className)} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      {scene.paint}
      {ghosts &&
        scene.cast.map((g, i) => (
          <g key={i} transform={`translate(${g.x - g.size / 2} ${g.y - g.size})`}>
            <PlaceholderGlyph rig={g.rig} role={g.role} shape={g.shape} size={g.size} />
          </g>
        ))}
      {pose && hero && <image className="seed-scene__hero" href={pose.url} x={hero.left} y={hero.top} width={hero.width} height={hero.height} preserveAspectRatio="none" />}
    </svg>
  );
}
