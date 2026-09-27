/**
 * The built-in libraries behind Scratch's "Choose a Sprite", "Choose a Costume" and
 * "Choose a Backdrop" buttons: a few simple drawings to start from (the compiler
 * draws anything else a game needs).
 */

import { ambleCostumes, svgAsset } from './defaults';
import type { ImageAsset } from './types';

export interface LibrarySprite {
  name: string;
  /** What the sprite is, for the AI (becomes the sprite's "About"). */
  description: string;
  costumes(): ImageAsset[];
}

const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

const art = (name: string, w: number, h: number, body: string) => svgAsset(name, svg(w, h, body), w, h);

const OUTLINE = 'stroke="#3a2a1a" stroke-width="3" stroke-linejoin="round"';

export const SPRITE_LIBRARY: LibrarySprite[] = [
  { name: 'Amble', description: 'A small, friendly walking creature.', costumes: ambleCostumes },
  {
    name: 'Ball',
    description: 'A bouncy ball.',
    costumes: () => [
      art(
        'ball',
        64,
        64,
        `<circle cx="32" cy="32" r="28" fill="#4c97ff" ${OUTLINE}/><path d="M8 26c14 6 34 6 48 0M8 38c14-6 34-6 48 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity="0.85"/><ellipse cx="22" cy="18" rx="7" ry="4" fill="#fff" opacity="0.55" transform="rotate(-30 22 18)"/>`,
      ),
    ],
  },
  {
    name: 'Star',
    description: 'A shiny yellow star.',
    costumes: () => [
      art(
        'star',
        72,
        70,
        `<path d="M36 4l9.4 19.6 21.4 2.8-15.7 14.8 4 21.2L36 52.2 16.9 62.4l4-21.2L5.2 26.4l21.4-2.8z" fill="#ffd21f" ${OUTLINE}/><path d="M36 14l5 10.5" stroke="#fff6b0" stroke-width="4" stroke-linecap="round"/>`,
      ),
    ],
  },
  {
    name: 'Heart',
    description: 'A red heart (a life or health pickup).',
    costumes: () => [
      art(
        'heart',
        68,
        60,
        `<path d="M34 56C12 42 4 30 4 19 4 10 11 4 19 4c6 0 11 3 15 9 4-6 9-9 15-9 8 0 15 6 15 15 0 11-8 23-30 37z" fill="#ff4d6d" ${OUTLINE}/><ellipse cx="18" cy="17" rx="6" ry="4" fill="#fff" opacity="0.5" transform="rotate(-35 18 17)"/>`,
      ),
    ],
  },
  {
    name: 'Coin',
    description: 'A spinning gold coin to collect.',
    costumes: () => [
      art(
        'coin',
        56,
        56,
        `<circle cx="28" cy="28" r="24" fill="#ffc933" ${OUTLINE}/><circle cx="28" cy="28" r="16" fill="none" stroke="#e0a100" stroke-width="3"/><path d="M28 18l3 6.3 6.8.9-5 4.8 1.3 6.8L28 33.4l-6.1 3.4 1.3-6.8-5-4.8 6.8-.9z" fill="#fff3b0"/>`,
      ),
    ],
  },
  {
    name: 'Gem',
    description: 'A sparkling blue gem.',
    costumes: () => [
      art(
        'gem',
        64,
        56,
        `<path d="M16 4h32l14 16-30 32L2 20z" fill="#3ec5f0" ${OUTLINE}/><path d="M2 20h60M16 4l8 16 8 32 8-32 8-16M24 20L32 4l8 16" fill="none" stroke="#1c7fa6" stroke-width="2" stroke-linejoin="round"/><path d="M18 9l-5 8" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.8"/>`,
      ),
    ],
  },
  {
    name: 'Apple',
    description: 'A red apple.',
    costumes: () => [
      art(
        'apple',
        60,
        66,
        `<path d="M30 18c-6-4-22-4-24 14-2 16 10 32 18 32 3 0 4-1.5 6-1.5s3 1.5 6 1.5c8 0 20-16 18-32-2-18-18-18-24-14z" fill="#e8413c" ${OUTLINE}/><path d="M30 18c0-6 2-11 6-14" fill="none" stroke="#5a3a1a" stroke-width="4" stroke-linecap="round"/><path d="M33 12c4-7 12-8 17-6-3 6-10 9-17 6z" fill="#6cc04a" stroke="#2f6b1f" stroke-width="2.5" stroke-linejoin="round"/><ellipse cx="17" cy="30" rx="4" ry="7" fill="#fff" opacity="0.4"/>`,
      ),
    ],
  },
  {
    name: 'Fish',
    description: 'A little orange fish that swims.',
    costumes: () => [
      art(
        'fish',
        84,
        56,
        `<path d="M62 28L82 10v36z" fill="#ff9f1a" ${OUTLINE}/><ellipse cx="36" cy="28" rx="32" ry="22" fill="#ffb347" ${OUTLINE}/><path d="M30 8c6 4 8 10 6 14M30 48c6-4 8-10 6-14" fill="none" stroke="#e07b00" stroke-width="3" stroke-linecap="round"/><circle cx="18" cy="23" r="6" fill="#fff" stroke="#3a2a1a" stroke-width="2.5"/><circle cx="16.5" cy="23" r="3" fill="#2b1a10"/><path d="M8 34q5 4 10 1" fill="none" stroke="#3a2a1a" stroke-width="2.5" stroke-linecap="round"/>`,
      ),
    ],
  },
  {
    name: 'Cloud',
    description: 'A fluffy white cloud.',
    costumes: () => [
      art(
        'cloud',
        110,
        64,
        `<path d="M28 58c-13 0-22-8-22-18s8-17 18-17c3-12 13-19 25-19 12 0 22 7 26 17 2-1 5-1 7-1 11 0 20 8 20 19s-9 19-20 19z" fill="#ffffff" stroke="#9fb3c8" stroke-width="3" stroke-linejoin="round"/><path d="M30 46c10 4 40 4 58 0" fill="none" stroke="#dbe7f3" stroke-width="4" stroke-linecap="round"/>`,
      ),
    ],
  },
  {
    name: 'Tree',
    description: 'A leafy green tree.',
    costumes: () => [
      art(
        'tree',
        90,
        120,
        `<rect x="37" y="72" width="16" height="44" rx="4" fill="#9b6a3c" ${OUTLINE}/><path d="M45 6c20 0 32 14 32 30 8 4 10 12 10 18 0 14-12 24-28 24H31C15 78 3 68 3 54c0-6 3-14 10-18 0-16 12-30 32-30z" fill="#4cbf56" stroke="#2f6b1f" stroke-width="3" stroke-linejoin="round"/><circle cx="30" cy="36" r="5" fill="#74d97d"/><circle cx="58" cy="50" r="6" fill="#74d97d"/><circle cx="40" cy="60" r="4" fill="#74d97d"/>`,
      ),
    ],
  },
  {
    name: 'Block',
    description: 'A solid brick block to stand on.',
    costumes: () => [
      art(
        'block',
        64,
        64,
        `<rect x="3" y="3" width="58" height="58" rx="4" fill="#c8703a" ${OUTLINE}/><path d="M3 22h58M3 42h58M24 3v19M44 22v20M24 42v19" stroke="#8a4a22" stroke-width="3"/><path d="M8 8h12" stroke="#f0a070" stroke-width="3" stroke-linecap="round"/>`,
      ),
    ],
  },
];

export interface LibraryBackdrop {
  name: string;
  make(): ImageAsset;
}

const backdrop = (name: string, body: string): LibraryBackdrop => ({ name, make: () => art(name, 480, 360, body) });

const gradient = (id: string, top: string, bottom: string) =>
  `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="480" height="360" fill="url(#${id})"/>`;

export const BACKDROP_LIBRARY: LibraryBackdrop[] = [
  backdrop(
    'Blue Sky',
    `${gradient('sky', '#7cc4ff', '#d8efff')}<circle cx="400" cy="70" r="34" fill="#ffe066"/><g fill="#fff"><ellipse cx="110" cy="80" rx="46" ry="18"/><ellipse cx="140" cy="68" rx="30" ry="18"/><ellipse cx="300" cy="120" rx="40" ry="14"/><ellipse cx="322" cy="110" rx="24" ry="14"/></g><path d="M0 280 Q 120 230 240 272 T 480 262 V360 H0z" fill="#7fd36b"/><path d="M0 310 Q 140 280 260 305 T 480 298 V360 H0z" fill="#58b64a"/>`,
  ),
  backdrop(
    'Night',
    `${gradient('night', '#141840', '#443a86')}<g fill="#fff"><circle cx="40" cy="40" r="1.6"/><circle cx="120" cy="90" r="1.2"/><circle cx="200" cy="30" r="1.8"/><circle cx="310" cy="70" r="1.3"/><circle cx="440" cy="130" r="1.5"/><circle cx="370" cy="150" r="1.1"/><circle cx="80" cy="160" r="1.2"/><circle cx="250" cy="120" r="1"/><circle cx="170" cy="190" r="1.3"/></g><circle cx="400" cy="70" r="26" fill="#fff6c9"/><circle cx="410" cy="62" r="24" fill="#23285a"/><path d="M0 300 Q 80 260 160 295 T 320 290 T 480 285 V360 H0z" fill="#2e6b3f"/><path d="M0 320 Q 120 290 240 318 T 480 312 V360 H0z" fill="#3f8a4f"/>`,
  ),
  backdrop(
    'Underwater',
    `${gradient('sea', '#39b3e6', '#0d4f8b')}<g fill="none" stroke="#bfefff" stroke-width="2" opacity="0.8"><circle cx="90" cy="200" r="8"/><circle cx="104" cy="160" r="5"/><circle cx="96" cy="126" r="3"/><circle cx="380" cy="230" r="7"/><circle cx="392" cy="190" r="4"/></g><path d="M0 318 Q 120 300 240 316 T 480 310 V360 H0z" fill="#e8c77a"/><g fill="none" stroke="#2fa35a" stroke-width="7" stroke-linecap="round"><path d="M40 330c-12-24 12-40 0-70"/><path d="M60 330c10-20-8-36 4-60"/><path d="M430 324c-12-26 10-44-2-76"/></g>`,
  ),
  backdrop(
    'Desert',
    `${gradient('desert', '#ffb56b', '#ffe3a8')}<circle cx="120" cy="90" r="40" fill="#fff1b8"/><path d="M0 250 Q 140 200 280 250 T 480 240 V360 H0z" fill="#f2b560"/><path d="M0 300 Q 160 260 320 300 T 480 292 V360 H0z" fill="#e39a45"/><g fill="#4f9a45" stroke="#2f6b1f" stroke-width="3" stroke-linejoin="round"><path d="M370 300v-70a12 12 0 0 1 24 0v70z"/><path d="M370 262h-12a8 8 0 0 1-8-8v-14a6 6 0 0 1 12 0v8h8z"/><path d="M394 250h12v-10a6 6 0 0 1 12 0v14a8 8 0 0 1-8 8h-16z"/></g>`,
  ),
  backdrop(
    'Space',
    `<rect width="480" height="360" fill="#0b0d24"/><g fill="#fff"><circle cx="30" cy="50" r="1.5"/><circle cx="90" cy="300" r="1.2"/><circle cx="150" cy="120" r="1.8"/><circle cx="230" cy="40" r="1.1"/><circle cx="290" cy="330" r="1.6"/><circle cx="350" cy="90" r="1.3"/><circle cx="440" cy="200" r="1.7"/><circle cx="60" cy="200" r="1"/><circle cx="410" cy="320" r="1.2"/><circle cx="200" cy="250" r="1.4"/></g><circle cx="330" cy="200" r="60" fill="#c86bfa"/><path d="M330 200m-60 0a60 60 0 0 0 120 0z" fill="#a24de0" opacity="0.6"/><ellipse cx="330" cy="200" rx="100" ry="22" fill="none" stroke="#ffd96b" stroke-width="7" transform="rotate(-15 330 200)"/><circle cx="110" cy="110" r="22" fill="#6bd0ff"/>`,
  ),
  backdrop(
    'Forest',
    `${gradient('forest', '#b7e4a0', '#e9f7d9')}<g fill="#3f9a4a"><path d="M40 300l40-150 40 150z"/><path d="M130 300l50-190 50 190z"/><path d="M330 300l45-170 45 170z"/><path d="M410 300l35-120 35 120z"/></g><g fill="#2f7a3a"><path d="M90 310l30-110 30 110z"/><path d="M250 310l40-150 40 150z"/></g><rect y="300" width="480" height="60" fill="#6fbf4a"/>`,
  ),
];

/** All the costumes in the sprite library, for "Choose a Costume". */
export function libraryCostumes(): ImageAsset[] {
  return SPRITE_LIBRARY.flatMap((s) => s.costumes());
}
