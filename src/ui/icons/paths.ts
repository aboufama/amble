/**
 * The icon set (§3.5): clean geometric line icons on a 24 px grid, drawn with a 2 px `currentColor`
 * stroke and round caps and joins; straight lines, true arcs and circles, no wobble. `dots` are small
 * filled circles. No Scratch metaphors (no flag, no stop octagon, no cat) and no sparkles: the AI is never
 * decorated (MAGIC-BRIEF).
 */
export interface IconDef {
  paths: string[];
  dots?: Array<[cx: number, cy: number, r: number]>;
}

/** A circle as path data (two arcs), for icons built from circles. */
function circle(cx: number, cy: number, r: number): string {
  const n = (v: number) => +v.toFixed(3);
  return `M${n(cx)} ${n(cy - r)}a${n(r)} ${n(r)} 0 1 0 0 ${n(2 * r)}a${n(r)} ${n(r)} 0 1 0 0 ${n(-2 * r)}z`;
}

const DRAWN = {
  back: { paths: ['M15 5l-7 7 7 7'] },
  play: { paths: ['M8 5.5v13l10.5-6.5z'] },
  change: {
    paths: [
      'M8 13V7.5a1.5 1.5 0 0 1 3 0V11',
      'M11 10.5V5.5a1.5 1.5 0 0 1 3 0v5',
      'M14 10.5v-3a1.5 1.5 0 0 1 3 0v6a6.5 6.5 0 0 1-6.5 6.5h-.3a5.5 5.5 0 0 1-4.6-2.5l-2.3-3.5a1.5 1.5 0 0 1 2.5-1.7L8 15',
    ],
  },
  pause: { paths: ['M9 5.5v13', 'M15 5.5v13'] },
  restart: { paths: ['M5 12a7 7 0 1 0 2.05-4.95', 'M7.05 3.05v4h4'] },
  fullscreen: { paths: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'] },
  draw: { paths: ['M4.5 19.5l1.1-4.4L15.8 4.9a2 2 0 0 1 2.8 0l.5.5a2 2 0 0 1 0 2.8L8.9 18.4z', 'M14.2 6.5l3.3 3.3'] },
  ink: { paths: ['M12 3.5l5.5 7.5-5.5 9.5-5.5-9.5z', 'M12 20v-5.5'], dots: [[12, 11.5, 1.2]] },
  pencil: { paths: ['M9 4h6v11l-3 5-3-5z', 'M9 15h6', 'M9 7.5h6'] },
  marker: { paths: ['M13.5 4.5l6 6-8 8H6v-5.5z', 'M11 7l6 6', 'M3.5 21.5h8'] },
  crayon: { paths: ['M9 9.5h6v11H9z', 'M9.5 9.5L12 3.5l2.5 6', 'M9 13.5h6', 'M9 17h6'] },
  airbrush: {
    paths: ['M8.5 9.5h7v10a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1z', 'M10.5 9.5V7h3v2.5'],
    dots: [[17.5, 6, 0.9], [19.8, 7.6, 0.9], [19.8, 4.4, 0.9], [17.5, 3, 0.8]],
  },
  eraser: { paths: ['M9 19.5h10.5', 'M5 14.5l8.2-8.7a2 2 0 0 1 2.9 0l2.6 2.6a2 2 0 0 1 0 2.9l-7.4 7.7H9.4z', 'M9 10.3l5 5'] },
  fill: {
    paths: [
      'M5.3 11.9l6.9-6.9 6.3 6.3-6.9 6.9a2 2 0 0 1-2.8 0l-3.5-3.5a2 2 0 0 1 0-2.8z',
      'M5 12h13.5',
      'M20.5 15.5c.8 1.2 1.2 2 1.2 2.6a1.2 1.2 0 0 1-2.4 0c0-.6.4-1.4 1.2-2.6z',
    ],
  },
  lasso: { paths: ['M12 5c4.4 0 8 2 8 4.5S16.4 14 12 14s-8-2-8-4.5S7.6 5 12 5z', 'M7 13c-1 1.8-.7 3.6.6 4.5 1.2.8 2.7.7 3.2 2.5'] },
  shapes: { paths: ['M13 13h7v7h-7z', circle(8, 7, 3.5), 'M4.5 20.5L8 14l3.5 6.5z'] },
  mirror: { paths: ['M12 3v2.5', 'M12 8v2.5', 'M12 13v2.5', 'M12 18v2.5', 'M9.5 7l-5 10h5z', 'M14.5 7l5 10h-5z'] },
  trace: { paths: ['M4 5.5h16v13H4z', 'M4.5 16l4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5'], dots: [[15.5, 9, 1.4]] },
  undo: { paths: ['M9 8.5h6a5 5 0 0 1 0 10H8.5', 'M12 5L8.5 8.5 12 12'] },
  redo: { paths: ['M15 8.5H9a5 5 0 0 0 0 10h6.5', 'M12 5l3.5 3.5L12 12'] },
  bones: {
    paths: [circle(12, 4.7, 1.9), 'M12 6.6v6', 'M7.5 11L12 9l4.5 2', 'M8 18.5l4-6 4 6'],
    dots: [[12, 9, 1.2], [12, 12.6, 1.2], [7.5, 11, 1.1], [16.5, 11, 1.1], [8, 18.5, 1.1], [16, 18.5, 1.1]],
  },
  star: { paths: ['M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'] },
  footprint: { paths: ['M12 3.5a3.8 5.5 0 1 0 0 11a3.8 5.5 0 1 0 0-11z', 'M12 15.5a2.8 2.6 0 1 0 0 5.2a2.8 2.6 0 1 0 0-5.2z'] },
  dial: { paths: [circle(12, 12, 7.5), 'M12 12l3.5-3.5', 'M12 2.5v1'], dots: [[12, 12, 1.3]] },
  twist: { paths: ['M12 12a1.5 1.5 0 0 1 3 0a3 3 0 0 1-6 0a4.5 4.5 0 0 1 9 0a6 6 0 0 1-12 0'] },
  eye: { paths: ['M2.5 12C4.8 8 8.1 6 12 6s7.2 2 9.5 6c-2.3 4-5.6 6-9.5 6s-7.2-2-9.5-6z', circle(12, 12, 2.5)] },
  eyeOff: { paths: ['M2.5 12C4.8 8 8.1 6 12 6s7.2 2 9.5 6c-2.3 4-5.6 6-9.5 6s-7.2-2-9.5-6z', circle(12, 12, 2.5), 'M4 4l16 16'] },
  plus: { paths: ['M12 5v14', 'M5 12h14'] },
  close: { paths: ['M6 6l12 12', 'M18 6L6 18'] },
  check: { paths: ['M5 12.5l4.5 4.5L19 7'] },
  more: { paths: [], dots: [[6, 12, 1.6], [12, 12, 1.6], [18, 12, 1.6]] },
  fileOpen: {
    paths: [
      'M4 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2h7A1.5 1.5 0 0 1 20 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z',
      'M12 16.5v-5.5',
      'M9.8 13.2L12 11l2.2 2.2',
    ],
  },
  fileSave: { paths: ['M12 4v10.5', 'M8 10.5l4 4 4-4', 'M4.5 15.5v3A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-3'] },
  drive: { paths: ['M7 18.5a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 9.5a4.5 4.5 0 0 1 .5 9z', 'M12 16v-5', 'M10 13l2-2 2 2'] },
  handIn: {
    paths: [
      'M4 13h4.5l1.5 2.5h4l1.5-2.5H20v5.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z',
      'M4 13l2.2-6.4A1.5 1.5 0 0 1 7.6 5.5H9',
      'M15 5.5h1.4a1.5 1.5 0 0 1 1.4 1.1L20 13',
      'M12 3v7.5',
      'M9.5 8l2.5 2.5L14.5 8',
    ],
  },
  sound: { paths: ['M4.5 9.5h3l4.5-4v13l-4.5-4h-3z', 'M15.5 9.5a3.5 3.5 0 0 1 0 5', 'M18 7a7 7 0 0 1 0 10'] },
  mic: { paths: ['M9.5 6a2.5 2.5 0 0 1 5 0v5.5a2.5 2.5 0 0 1-5 0z', 'M6.5 11.5a5.5 5.5 0 0 0 11 0', 'M12 17v3.5'] },
  captions: { paths: ['M3.5 6h17v12h-17z', 'M7 11h4', 'M13.5 11H17', 'M7 14.5h6', 'M15.5 14.5H17'] },
  lock: { paths: ['M6.5 11h11v8.5h-11z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'], dots: [[12, 15.2, 1.3]] },
  info: { paths: [circle(12, 12, 8), 'M12 11v5'], dots: [[12, 7.9, 1.2]] },
  warning: { paths: ['M12 4.5l8.5 15h-17z', 'M12 10v4'], dots: [[12, 16.8, 1.2]] },
  teacher: { paths: ['M2.5 9.5L12 5.5l9.5 4-9.5 4z', 'M6.5 11.5v4.3c1.6 1.3 3.5 1.9 5.5 1.9s3.9-.6 5.5-1.9v-4.3', 'M21.5 9.5v5'] },
  settings: { paths: ['M4 7h9', 'M17 7h3', circle(15, 7, 2), 'M4 12h3', 'M11 12h9', circle(9, 12, 2), 'M4 17h10', 'M18 17h2', circle(16, 17, 2)] },
  list: { paths: ['M9 7h11', 'M9 12h11', 'M9 17h11'], dots: [[5, 7, 1.3], [5, 12, 1.3], [5, 17, 1.3]] },
  trail: { paths: ['M4.5 20c4 0 8-1.5 8-4.5S8 11.5 8 8.5s3.5-4 11.5-4'], dots: [[19.5, 4.5, 1.4], [4.5, 12, 1.1], [16, 13.5, 1.1]] },
  zoomIn: { paths: [circle(10.5, 10.5, 6.5), 'M15.3 15.3L20 20', 'M10.5 8v5', 'M8 10.5h5'] },
  zoomOut: { paths: [circle(10.5, 10.5, 6.5), 'M15.3 15.3L20 20', 'M8 10.5h5'] },
  pivot: { paths: [circle(12, 12, 4.8), 'M12 3.5V6', 'M12 18v2.5', 'M3.5 12H6', 'M18 12h2.5'], dots: [[12, 12, 1.4]] },
  layer: { paths: ['M12 4.5l8 4.2-8 4.2-8-4.2z', 'M4 12.6l8 4.2 8-4.2', 'M4 16.3l8 4.2 8-4.2'] },
  frame: { paths: ['M8 4.5h11v12H8z', 'M5.5 7.5v12h11'] },
  readAloud: {
    paths: [
      'M4.5 5.5H14A1.5 1.5 0 0 1 15.5 7v6.5A1.5 1.5 0 0 1 14 15H9.5L6 18v-3H4.5A1.5 1.5 0 0 1 3 13.5V7a1.5 1.5 0 0 1 1.5-1.5z',
      'M18.5 8a4.5 4.5 0 0 1 0 6.5',
      'M20.8 5.8a7.6 7.6 0 0 1 0 10.9',
      'M6.5 9.2H12',
      'M6.5 11.8H10',
    ],
  },
} satisfies Record<string, IconDef>;

/**
 * Names retired from the set. They still type-check and draw nothing, so screens that have not dropped
 * them yet keep building (and never show them). Remove each once nothing names it.
 */
export const RETIRED_ICONS = ['sparkle'] as const;

export type RetiredIconName = (typeof RETIRED_ICONS)[number];

export type IconName = keyof typeof DRAWN | RetiredIconName;

/** Every icon by name. A retired name has no drawing. */
export const ICONS: { readonly [K in keyof typeof DRAWN]: IconDef } & { readonly [K in RetiredIconName]?: IconDef } = DRAWN;
