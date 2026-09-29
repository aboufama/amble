/**
 * Synthetic "kid drawings" for tests, the dev harness and example fallbacks, each with the joints a
 * person would place (ground truth). Deterministic: the same seed paints the same pixels anywhere.
 *
 * The set covers every kind plus the failures the designers hit with real drawings: legs drawn close
 * together, a raised arm holding a wand, boots that almost touch, navy trousers that look like ink,
 * and near/far legs that a global closing would merge.
 */
import type { BoneRole, CharacterKind, Pixels, Point } from '../types';
import { INK, KidCanvas, capsule, ellipse, rng, roundRect, star, type ShapeStyle } from './pen';
import type { Pt } from './raster';

const TAU = Math.PI * 2;

/** Where a joint should end up: the start or the end (tip) of the bone with this role (or name). */
export interface JointTruth {
  bone: BoneRole | string;
  end: 'start' | 'end';
  at: Point;
  /** Allowed distance in art px. */
  tol: number;
}

export interface SampleDrawing {
  name: string;
  kind: CharacterKind;
  /** What the drawing shows, for people reading test output. */
  about: string;
  image: Pixels;
  layers: Record<string, Pixels>;
  truth: JointTruth[];
  /** Expected ground contact (anchor). */
  anchor?: { at: Point; tol: number };
  /** Bones the fit must produce (roles or names), beyond the truth list. */
  expect?: string[];
}

const J = (bone: string, end: 'start' | 'end', x: number, y: number, tol: number): JointTruth => ({ bone, end, at: [x, y], tol });

// ------------------------------------------------------------------ people

interface HeroOptions {
  seed?: number;
  pants?: string;
  /** Raise the right arm and give it a wand. */
  wand?: boolean;
  /** Draw each body piece on its own `part:` layer. */
  parts?: boolean;
}

function paintHero(o: HeroOptions): { k: KidCanvas; w: number; h: number } {
  const w = o.wand ? 270 : 260, h = 330;
  const k = new KidCanvas(w, h, rng(o.seed ?? 7));
  const skin = '#f3c796', shirt = '#e2483d', pants = o.pants ?? '#3f6fd6', shoe = '#5b3a24';
  const P = (part: string, st: ShapeStyle): ShapeStyle => (o.parts ? { ...st, part } : st);
  k.shape(capsule(112, 205, 104, 286, 14, 12), P('legL', { fill: pants, stroke: INK }));
  k.shape(capsule(148, 205, 156, 286, 14, 12), P('legR', { fill: pants, stroke: INK }));
  k.shape(ellipse(97, 294, 20, 11), P('legL', { fill: shoe, stroke: INK }));
  k.shape(ellipse(163, 294, 20, 11), P('legR', { fill: shoe, stroke: INK }));
  k.shape(capsule(130, 146, 130, 196, 38, 36), P('torso', { fill: shirt, stroke: INK }));
  k.shape(star(130, 168, 16, 7), P('torso', { fill: '#ffd23f', stroke: INK, lw: 2.5, amp: 0.8, scribble: false }));
  k.shape(capsule(100, 134, 48, 194, 12, 10), P('armL', { fill: shirt, stroke: INK }));
  k.shape(ellipse(42, 201, 13, 13), P('armL', { fill: skin, stroke: INK }));
  if (o.wand) {
    // right arm raised up and out, a wand with a star in the fist
    k.line([[212, 52], [226, 30], [240, 10]], '#6b4a2b', 5, 0.4, o.parts ? { part: 'armR' } : {});
    k.shape(star(242, 12, 11, 5), P('armR', { fill: '#ffe45c', stroke: INK, lw: 2.5, amp: 0.5, scribble: false }));
    k.shape(capsule(160, 136, 204, 70, 12, 10), P('armR', { fill: shirt, stroke: INK }));
    k.shape(ellipse(210, 60, 13, 13), P('armR', { fill: skin, stroke: INK }));
  } else {
    k.shape(capsule(160, 134, 212, 194, 12, 10), P('armR', { fill: shirt, stroke: INK }));
    k.shape(ellipse(218, 201, 13, 13), P('armR', { fill: skin, stroke: INK }));
  }
  k.shape(ellipse(130, 76, 47, 43), P('head', { fill: skin, stroke: INK }));
  const hair: Pt[] = [];
  for (let i = 0; i <= 14; i++) {
    const a = Math.PI + (i / 14) * Math.PI;
    const r = i % 2 ? 49 : 60;
    hair.push([130 + Math.cos(a) * r * 1.02, 70 + Math.sin(a) * r * 0.9]);
  }
  for (let i = 14; i >= 0; i--) {
    const a = Math.PI + (i / 14) * Math.PI;
    hair.push([130 + Math.cos(a) * 44, 74 + Math.sin(a) * 26]);
  }
  k.shape(hair, P('head', { fill: '#4a3222', stroke: INK, lw: 3.5 }));
  const face = o.parts ? { part: 'head' } : {};
  for (const x of [113, 147]) k.dot(x, 80, 5.5, 7, INK, 1, { ...face, ink: true });
  for (const x of [115, 149]) k.dot(x, 77, 2, 2, '#ffffff', 1, face);
  k.line([[112, 97], [122, 105], [138, 105], [148, 96]], INK, 3.5, 0.6, face);
  for (const x of [100, 160]) k.dot(x, 94, 7, 7, '#f06e6e', 0.35, face);
  return { k, w, h };
}

const HERO_TRUTH: JointTruth[] = [
  J('head', 'end', 130, 18, 20),
  J('head', 'start', 130, 114, 16),
  J('spine', 'start', 130, 208, 20),
  J('armL1', 'start', 101, 133, 16),
  J('armL2', 'start', 70, 168, 18),
  J('armL2', 'end', 33, 209, 14),
  J('armR1', 'start', 159, 133, 16),
  J('legL1', 'start', 111, 230, 16),
  // anywhere on the shoe's sole
  J('legL2', 'end', 95, 300, 26),
  J('legR1', 'start', 149, 230, 16),
  J('legR2', 'end', 165, 300, 26),
];

export function drawHero(seed = 7): SampleDrawing {
  const { k } = paintHero({ seed });
  return {
    name: 'hero', kind: 'biped', about: 'a kid hero facing you, outlined and coloured, a star on the shirt',
    ...k.result(),
    truth: [...HERO_TRUTH, J('armR2', 'end', 227, 209, 14)],
    anchor: { at: [130, 305], tol: 10 },
  };
}

/** The mockup failure: navy trousers are darker than the "ink" threshold. */
export function drawNavyHero(seed = 7): SampleDrawing {
  const { k } = paintHero({ seed, pants: '#1f2753' });
  return {
    name: 'navy', kind: 'biped', about: 'the hero in navy trousers (dark fill, not ink)',
    ...k.result(),
    truth: [...HERO_TRUTH, J('legL2', 'start', 106, 266, 18), J('legR2', 'start', 154, 266, 18)],
    anchor: { at: [130, 305], tol: 10 },
  };
}

/** The hero drawn in parts: every piece on its own layer, hidden areas included. */
export function drawLayeredHero(seed = 7): SampleDrawing {
  const { k } = paintHero({ seed, parts: true });
  return {
    name: 'layered', kind: 'biped', about: 'the hero drawn on part layers (head, torso, arms, legs)',
    ...k.result(),
    truth: [...HERO_TRUTH, J('armR2', 'end', 227, 209, 14)],
    anchor: { at: [130, 305], tol: 10 },
  };
}

/** The mockup failure: the right arm raised overhead holding a wand. */
export function drawWandHero(seed = 7): SampleDrawing {
  const { k } = paintHero({ seed, wand: true });
  return {
    name: 'wand', kind: 'biped', about: 'the hero raising a wand with a star',
    ...k.result(),
    truth: [
      ...HERO_TRUTH.filter((t) => t.bone !== 'armR1'),
      J('armR1', 'start', 160, 134, 18),
      J('armR2', 'end', 214, 55, 18),
    ],
    expect: ['wand'],
    anchor: { at: [130, 305], tol: 10 },
  };
}

export function drawStick(seed = 3): SampleDrawing {
  const k = new KidCanvas(200, 280, rng(seed));
  const lw = 5;
  k.shape(ellipse(100, 48, 30, 30), { stroke: INK, lw });
  k.line([[100, 78], [101, 125], [100, 172]], INK, lw);
  k.line([[100, 104], [74, 128], [50, 152]], INK, lw);
  k.line([[100, 104], [127, 126], [152, 148]], INK, lw);
  k.line([[100, 172], [82, 216], [62, 262]], INK, lw);
  k.line([[100, 172], [119, 216], [140, 262]], INK, lw);
  for (const x of [89, 111]) k.dot(x, 44, 3.5, 3.5, INK, 1, { ink: true });
  k.line([[88, 58], [100, 64], [112, 58]], INK, 3, 0.4);
  return {
    name: 'stick', kind: 'biped', about: 'a stick figure with an outline head',
    ...k.result(),
    truth: [
      J('head', 'end', 100, 16, 14),
      J('head', 'start', 100, 80, 16),
      J('armL1', 'start', 100, 106, 16),
      J('armL2', 'end', 49, 154, 12),
      J('armR2', 'end', 153, 150, 12),
      J('legL1', 'start', 100, 175, 16),
      J('legL2', 'start', 82, 216, 16),
      J('legL2', 'end', 61, 265, 12),
      J('legR2', 'end', 141, 265, 12),
    ],
    anchor: { at: [101, 265], tol: 10 },
  };
}

/**
 * The designers' astronaut: a big drawing (880 px tall) with a helmet, an antenna, arms hanging close
 * to the body and boots that almost touch (5 px apart), so at a 150 px working size the gap between
 * the legs closes into a hole and the legs look like one.
 */
export function drawAstronaut(seed = 13): SampleDrawing {
  const k = new KidCanvas(400, 880, rng(seed));
  const suit = '#f7a13a', boot = '#f1eee6', glass = '#d7ebff', skin = '#b9794f';
  const lw = 7;
  k.shape(capsule(150, 690, 150, 790, 36, 36), { fill: suit, stroke: INK, lw });
  k.shape(capsule(250, 690, 250, 790, 36, 36), { fill: suit, stroke: INK, lw });
  k.shape(ellipse(146, 815, 48, 30), { fill: boot, stroke: INK, lw });
  k.shape(ellipse(254, 815, 48, 30), { fill: boot, stroke: INK, lw });
  k.shape(capsule(118, 470, 78, 628, 22, 20), { fill: suit, stroke: INK, lw });
  k.shape(capsule(282, 470, 322, 628, 22, 20), { fill: suit, stroke: INK, lw });
  k.shape(ellipse(72, 656, 32, 30), { fill: boot, stroke: INK, lw });
  k.shape(ellipse(328, 656, 32, 30), { fill: boot, stroke: INK, lw });
  k.shape(roundRect(108, 400, 292, 722, 40), { fill: suit, stroke: INK, lw });
  k.shape(roundRect(108, 596, 292, 636, 6), { fill: '#2fc2b0', stroke: INK, lw: 5 });
  k.shape(star(236, 490, 26, 11), { fill: '#ffd23f', stroke: INK, lw: 5, scribble: false });
  k.line([[222, 110], [246, 70], [262, 36]], INK, 6, 0.6);
  k.shape(ellipse(266, 30, 18, 18), { fill: '#f04d5d', stroke: INK, lw: 5 });
  k.shape(ellipse(200, 250, 150, 148), { fill: glass, stroke: INK, lw });
  k.shape(ellipse(200, 262, 92, 96), { fill: skin, stroke: INK, lw: 6 });
  for (const x of [168, 232]) k.dot(x, 262, 10, 13, INK, 1, { ink: true });
  k.line([[168, 312], [200, 326], [232, 310]], INK, 6, 0.5);
  return {
    name: 'astronaut', kind: 'biped', about: 'a tall astronaut with boots almost touching and an antenna',
    ...k.result(),
    // arms drawn along the body are not found without hints (see `astronautArms` for the guided case)
    truth: [
      J('head', 'start', 200, 390, 40),
      J('legL1', 'start', 150, 722, 34),
      J('legL2', 'end', 144, 846, 26),
      J('legR1', 'start', 250, 722, 34),
      J('legR2', 'end', 256, 846, 26),
    ],
    expect: ['extra'],
    anchor: { at: [200, 846], tol: 16 },
  };
}

/**
 * Legs drawn close together (a 7 px slit in a 760 px drawing): the gap closes at a 150 px working
 * size and only a larger working size keeps the legs apart.
 */
export function drawCloseLegs(seed = 17): SampleDrawing {
  const k = new KidCanvas(340, 760, rng(seed));
  const dress = '#8f6cf0', skin = '#e0a878', lw = 6;
  k.shape(roundRect(126, 480, 163, 716, 18), { fill: '#3d8a5a', stroke: INK, lw });
  k.shape(roundRect(177, 480, 214, 716, 18), { fill: '#3d8a5a', stroke: INK, lw });
  k.shape(roundRect(96, 700, 163, 736, 16), { fill: '#6b3b25', stroke: INK, lw });
  k.shape(roundRect(177, 700, 244, 736, 16), { fill: '#6b3b25', stroke: INK, lw });
  k.shape(capsule(114, 300, 56, 470, 20, 17), { fill: dress, stroke: INK, lw });
  k.shape(capsule(226, 300, 284, 470, 20, 17), { fill: dress, stroke: INK, lw });
  k.shape(ellipse(52, 492, 22, 22), { fill: skin, stroke: INK, lw });
  k.shape(ellipse(288, 492, 22, 22), { fill: skin, stroke: INK, lw });
  k.shape(roundRect(98, 260, 242, 500, 36), { fill: dress, stroke: INK, lw });
  k.shape(ellipse(170, 160, 86, 92), { fill: skin, stroke: INK, lw });
  for (const x of [140, 200]) k.dot(x, 160, 8, 10, INK, 1, { ink: true });
  k.line([[140, 205], [170, 220], [200, 204]], INK, 5, 0.5);
  return {
    name: 'closeLegs', kind: 'biped', about: 'legs drawn with a narrow slit between them (7 px in 760)',
    ...k.result(),
    truth: [
      J('head', 'end', 170, 66, 26),
      J('legL1', 'start', 147, 502, 36),
      // anywhere along the shoe's sole
      J('legL2', 'end', 122, 736, 40),
      J('legR1', 'start', 193, 502, 36),
      J('legR2', 'end', 218, 736, 40),
      J('armL2', 'end', 42, 508, 30),
      J('armR2', 'end', 298, 508, 30),
    ],
    anchor: { at: [170, 740], tol: 14 },
  };
}

// ------------------------------------------------------------------ animals

export function drawDog(seed = 11): SampleDrawing {
  const k = new KidCanvas(330, 250, rng(seed));
  const fur = '#c98a4b', dark = '#9a6232';
  k.shape(capsule(98, 140, 92, 214, 12, 10), { fill: dark, stroke: INK });
  k.shape(capsule(204, 142, 210, 214, 12, 10), { fill: dark, stroke: INK });
  k.shape(capsule(80, 112, 38, 70, 8, 5), { fill: fur, stroke: INK });
  k.shape(ellipse(152, 124, 84, 41), { fill: fur, stroke: INK });
  k.shape(ellipse(122, 110, 18, 12, 0.3), { fill: dark, amp: 1, scribble: false });
  k.shape(ellipse(170, 136, 14, 9, -0.2), { fill: dark, amp: 1, scribble: false });
  k.shape(capsule(124, 146, 122, 220, 13, 11), { fill: fur, stroke: INK });
  k.shape(capsule(230, 140, 238, 220, 13, 11), { fill: fur, stroke: INK });
  k.shape(capsule(222, 112, 248, 76, 19, 16), { fill: fur, stroke: INK });
  k.line([[212, 100], [226, 114], [240, 118]], '#d0302a', 6, 0.5, { ink: false });
  k.shape(ellipse(258, 62, 34, 26), { fill: fur, stroke: INK });
  k.shape(ellipse(290, 73, 19, 13), { fill: fur, stroke: INK });
  k.shape(ellipse(240, 62, 10, 22, 0.45), { fill: dark, stroke: INK, lw: 3 });
  k.dot(305, 68, 5.5, 5.5, INK, 1, { ink: true });
  k.dot(266, 54, 4.5, 5.5, INK, 1, { ink: true });
  k.dot(267.5, 52, 1.6, 1.6, '#ffffff');
  k.line([[284, 82], [292, 86], [300, 83]], INK, 2.5, 0.4);
  return {
    name: 'dog', kind: 'quadruped', about: 'a dog in side view, near and far legs touching, a tail',
    ...k.result(),
    truth: [
      J('head', 'end', 309, 70, 24),
      J('legBL1', 'start', 97, 162, 22),
      J('legBL2', 'end', 92, 225, 16),
      J('legBR1', 'start', 124, 162, 22),
      J('legBR2', 'end', 122, 231, 16),
      J('legFL1', 'start', 206, 162, 22),
      J('legFL2', 'end', 210, 225, 16),
      J('legFR1', 'start', 232, 160, 22),
      J('legFR2', 'end', 238, 231, 16),
      J('tail1', 'start', 76, 108, 18),
    ],
    anchor: { at: [165, 231], tol: 14 },
  };
}

/**
 * A cat whose four legs are drawn a few pixels apart and in one colour: a global morphological
 * closing (or a coarse working size) glues near and far legs together.
 */
export function drawCat(seed = 19): SampleDrawing {
  const k = new KidCanvas(360, 250, rng(seed));
  const fur = '#8a8f9c';
  const legs: [number, number][] = [[92, 99], [117, 124], [236, 243], [261, 268]];
  for (const [xa, xb] of legs) k.shape(capsule(xa, 150, xb, 222, 10, 9), { fill: fur, stroke: INK, lw: 3.5 });
  k.shape(capsule(66, 118, 22, 58, 7, 5), { fill: fur, stroke: INK, lw: 3.5 });
  k.shape(ellipse(180, 128, 104, 40), { fill: fur, stroke: INK, lw: 3.5 });
  k.shape(ellipse(296, 86, 38, 32), { fill: fur, stroke: INK, lw: 3.5 });
  k.shape([[270, 64], [276, 30], [292, 58]], { fill: fur, stroke: INK, lw: 3 });
  k.shape([[300, 56], [318, 26], [324, 62]], { fill: fur, stroke: INK, lw: 3 });
  for (const x of [288, 312]) k.dot(x, 84, 4, 5, INK, 1, { ink: true });
  return {
    name: 'cat', kind: 'quadruped', about: 'a cat with four legs drawn close together in one colour',
    ...k.result(),
    truth: [
      J('legBL2', 'end', 99, 232, 18),
      J('legBR2', 'end', 124, 232, 18),
      J('legFL2', 'end', 243, 232, 18),
      J('legFR2', 'end', 268, 232, 18),
      J('tail1', 'start', 70, 112, 22),
    ],
    anchor: { at: [184, 232], tol: 16 },
  };
}

// ------------------------------------------------------------------ blobs

export function drawSlime(seed = 5): SampleDrawing {
  const k = new KidCanvas(230, 210, rng(seed));
  const body: Pt[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * Math.PI;
    body.push([115 + 96 * Math.cos(t), 178 - 138 * Math.pow(Math.sin(t), 0.8)]);
  }
  for (let i = 0; i <= 16; i++) {
    const x = 19 + (i / 16) * 192;
    body.push([x, 180 + 5 * Math.sin(i * 1.3) + (i % 5 === 2 ? 9 : 0)]);
  }
  body.reverse();
  k.line([[114, 44], [112, 26], [118, 14]], '#2f6b2b', 4, 0.6, { ink: false });
  k.shape(ellipse(130, 14, 13, 7, -0.4), { fill: '#7bd05a', stroke: INK, lw: 2.5, scribble: false });
  k.shape(body, { fill: '#5ccf6a', stroke: '#1f5a28', lw: 4.5 });
  k.dot(70, 88, 14, 24, '#ffffff', 0.55);
  for (const x of [92, 140]) {
    k.shape(ellipse(x, 114, 17, 21), { fill: '#ffffff', stroke: INK, lw: 3, scribble: false });
    k.dot(x + 4, 118, 8, 8, INK, 1, { ink: true });
    k.dot(x + 6, 114, 2.5, 2.5, '#ffffff');
  }
  k.line([[96, 148], [108, 158], [126, 158], [138, 147]], INK, 4, 0.5);
  return {
    name: 'slime', kind: 'blob', about: 'a slime with a sprout on top',
    ...k.result(),
    truth: [J('body', 'start', 115, 188, 16), J('top', 'end', 115, 42, 20)],
    expect: ['extra'],
    anchor: { at: [115, 190], tol: 10 },
  };
}

// ------------------------------------------------------------------ flyers

export function drawBird(seed = 23): SampleDrawing {
  const k = new KidCanvas(300, 240, rng(seed));
  const feather = '#4aa3df', belly = '#f6d36b';
  k.line([[140, 168], [136, 196], [128, 214]], '#e08a2e', 4, 0.4);
  k.line([[166, 168], [170, 196], [178, 214]], '#e08a2e', 4, 0.4);
  k.shape([[96, 118], [30, 96], [40, 120], [26, 140], [98, 138]], { fill: feather, stroke: INK, lw: 3.5 });
  k.shape(ellipse(150, 132, 62, 42), { fill: feather, stroke: INK, lw: 4 });
  k.shape(ellipse(162, 146, 36, 22), { fill: belly, amp: 1, scribble: false });
  k.shape(ellipse(222, 94, 30, 28), { fill: feather, stroke: INK, lw: 4 });
  k.shape([[246, 86], [284, 98], [248, 106]], { fill: '#f29a2e', stroke: INK, lw: 3 });
  k.dot(230, 88, 5, 6, INK, 1, { ink: true });
  k.shape([[132, 118], [100, 30], [128, 48], [150, 22], [168, 110]], { fill: '#2f7fbf', stroke: INK, lw: 3.5 });
  return {
    name: 'bird', kind: 'flyer', about: 'a bird in side view, one wing up, a tail and thin legs',
    ...k.result(),
    truth: [
      J('head', 'end', 284, 98, 22),
      J('wingR2', 'end', 125, 26, 32),
      J('tail1', 'start', 96, 126, 26),
    ],
    anchor: { at: [153, 216], tol: 16 },
  };
}

export function drawBat(seed = 29): SampleDrawing {
  const k = new KidCanvas(360, 220, rng(seed));
  const wingC = '#5b4a7a', body = '#3d3350';
  const wing = (s: number): Pt[] => {
    const pts: Pt[] = [[180 + s * 20, 90], [180 + s * 70, 50], [180 + s * 130, 36], [180 + s * 168, 70]];
    for (let i = 1; i <= 4; i++) {
      const x = 180 + s * (168 - i * 34);
      pts.push([x + s * 17, 118 - (i % 2 ? 22 : 8)]);
      pts.push([x, 104 + (i === 4 ? 16 : 0)]);
    }
    pts.push([180 + s * 20, 128]);
    return pts;
  };
  k.shape(wing(-1), { fill: wingC, stroke: INK, lw: 3.5 });
  k.shape(wing(1), { fill: wingC, stroke: INK, lw: 3.5 });
  k.shape(ellipse(180, 118, 28, 40), { fill: body, stroke: INK, lw: 4 });
  k.shape(ellipse(180, 68, 26, 24), { fill: body, stroke: INK, lw: 4 });
  k.shape([[160, 56], [158, 24], [174, 48]], { fill: body, stroke: INK, lw: 3 });
  k.shape([[186, 48], [202, 24], [200, 56]], { fill: body, stroke: INK, lw: 3 });
  for (const x of [170, 190]) k.dot(x, 66, 4, 4, '#ffd23f');
  k.line([[168, 156], [164, 176]], INK, 4, 0.3);
  k.line([[192, 156], [196, 176]], INK, 4, 0.3);
  return {
    name: 'bat', kind: 'flyer', about: 'a bat facing you, wings spread',
    ...k.result(),
    truth: [
      J('head', 'end', 180, 26, 24),
      J('wingL2', 'end', 14, 70, 30),
      J('wingR2', 'end', 346, 70, 30),
    ],
    anchor: { at: [180, 178], tol: 16 },
  };
}

// ------------------------------------------------------------------ swimmers

export function drawFish(seed = 31): SampleDrawing {
  const k = new KidCanvas(320, 200, rng(seed));
  const scales = '#ff8c42';
  k.shape([[70, 100], [18, 52], [34, 100], [16, 150]], { fill: '#ffb347', stroke: INK, lw: 3.5 });
  k.shape([[150, 64], [176, 22], [212, 66]], { fill: '#ffb347', stroke: INK, lw: 3.5 });
  k.shape(ellipse(172, 100, 112, 50), { fill: scales, stroke: INK, lw: 4 });
  k.dot(248, 88, 9, 9, '#ffffff', 1);
  k.dot(250, 89, 5, 5, INK, 1, { ink: true });
  k.line([[260, 118], [276, 124], [284, 116]], INK, 3, 0.3);
  for (const x of [130, 160, 190]) k.line([[x, 80], [x + 10, 100], [x, 120]], '#c85a1c', 3, 0.3, { ink: false });
  return {
    name: 'fish', kind: 'swimmer', about: 'a fish swimming right, a tail fin and a top fin',
    ...k.result(),
    truth: [J('head', 'end', 286, 102, 20), J('tail', 'end', 18, 100, 30)],
    anchor: { at: [172, 152], tol: 14 },
  };
}

export function drawSnake(seed = 37): SampleDrawing {
  const k = new KidCanvas(420, 170, rng(seed));
  const spine: Pt[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    spine.push([30 + t * 330, 96 + Math.sin(t * TAU * 1.25) * 34]);
  }
  const outline: Pt[] = [];
  const rad = (t: number) => 5 + 13 * Math.pow(t, 0.6);
  for (let i = 0; i <= 40; i++) {
    const [x, y] = spine[i];
    const [x2, y2] = spine[Math.min(40, i + 1)], [x0, y0] = spine[Math.max(0, i - 1)];
    const nx = -(y2 - y0), ny = x2 - x0, l = Math.hypot(nx, ny) || 1;
    outline.push([x + (nx / l) * rad(i / 40), y + (ny / l) * rad(i / 40)]);
  }
  for (let i = 40; i >= 0; i--) {
    const [x, y] = spine[i];
    const [x2, y2] = spine[Math.min(40, i + 1)], [x0, y0] = spine[Math.max(0, i - 1)];
    const nx = -(y2 - y0), ny = x2 - x0, l = Math.hypot(nx, ny) || 1;
    outline.push([x - (nx / l) * rad(i / 40), y - (ny / l) * rad(i / 40)]);
  }
  k.shape(outline, { fill: '#62b74a', stroke: INK, lw: 3.5 });
  k.shape(ellipse(372, 88, 30, 22, 0.1), { fill: '#62b74a', stroke: INK, lw: 3.5 });
  k.dot(382, 80, 4, 5, INK, 1, { ink: true });
  k.line([[398, 96], [412, 100]], '#d0302a', 3, 0.2, { ink: false });
  return {
    name: 'snake', kind: 'swimmer', about: 'a long wavy snake, head on the right',
    ...k.result(),
    truth: [J('head', 'end', 402, 90, 22), J('tail', 'end', 26, 96, 26)],
    anchor: { at: [262, 148], tol: 40 },
  };
}

// ------------------------------------------------------------------ things

export function drawCrate(seed = 41): SampleDrawing {
  const k = new KidCanvas(200, 190, rng(seed));
  k.shape(roundRect(20, 24, 180, 176, 8), { fill: '#c98a4b', stroke: INK, lw: 4.5 });
  for (const y of [72, 124]) k.line([[24, y], [176, y]], INK, 3.5, 0.6);
  k.line([[30, 30], [170, 170]], INK, 3.5, 0.8);
  return {
    name: 'crate', kind: 'object', about: 'a wooden crate',
    ...k.result(),
    truth: [J('body', 'start', 100, 178, 14)],
    anchor: { at: [100, 178], tol: 10 },
  };
}

export function drawCar(seed = 43): SampleDrawing {
  const k = new KidCanvas(340, 200, rng(seed));
  k.shape(roundRect(92, 36, 236, 104, 22), { fill: '#9fe3ff', stroke: INK, lw: 4 });
  k.shape(roundRect(24, 88, 316, 150, 20), { fill: '#e2483d', stroke: INK, lw: 4.5 });
  for (const x of [88, 252]) {
    k.shape(ellipse(x, 154, 30, 30), { fill: '#333344', stroke: INK, lw: 4 });
    k.shape(ellipse(x, 154, 10, 10), { fill: '#d8d8e0', stroke: INK, lw: 3, scribble: false });
  }
  k.line([[180, 38], [196, 12]], INK, 3, 0.3);
  return {
    name: 'car', kind: 'object', about: 'a car with two wheels and an aerial',
    ...k.result(),
    truth: [J('wheel1', 'start', 88, 154, 12), J('wheel2', 'start', 252, 154, 12)],
    anchor: { at: [170, 186], tol: 12 },
  };
}

export interface SampleDef {
  name: string;
  kind: CharacterKind;
  draw: () => SampleDrawing;
}

/** Every sample, in the order the harness shows them. */
export const SAMPLES: SampleDef[] = [
  { name: 'hero', kind: 'biped', draw: drawHero },
  { name: 'stick', kind: 'biped', draw: drawStick },
  { name: 'navy', kind: 'biped', draw: drawNavyHero },
  { name: 'wand', kind: 'biped', draw: drawWandHero },
  { name: 'layered', kind: 'biped', draw: drawLayeredHero },
  { name: 'astronaut', kind: 'biped', draw: drawAstronaut },
  { name: 'closeLegs', kind: 'biped', draw: drawCloseLegs },
  { name: 'dog', kind: 'quadruped', draw: drawDog },
  { name: 'cat', kind: 'quadruped', draw: drawCat },
  { name: 'slime', kind: 'blob', draw: drawSlime },
  { name: 'bird', kind: 'flyer', draw: drawBird },
  { name: 'bat', kind: 'flyer', draw: drawBat },
  { name: 'fish', kind: 'swimmer', draw: drawFish },
  { name: 'snake', kind: 'swimmer', draw: drawSnake },
  { name: 'crate', kind: 'object', draw: drawCrate },
  { name: 'car', kind: 'object', draw: drawCar },
];
