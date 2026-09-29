/**
 * World-type thumbnails (§2.3, §2.5): the student's character, posed (the rig preview at `idle`, t 0.3),
 * standing inside each seed's scene. The geometry is pure (`heroRect`); `renderPose` makes the picture
 * once per drawing version and keeps it for the page's life.
 */
import type { RigData } from '../cores/rig';
import type { StarterId } from '../model/types';

/** The five world types on the New world sheet, in the spec's order. */
export const SHEET_SEEDS: readonly StarterId[] = ['moon-king', 'sky-run', 'clanks-climb', 'lantern-maze', 'wobble-tower'];
/** The four the First page offers after Bring it to life. */
export const FIRST_SEEDS: readonly StarterId[] = ['moon-king', 'sky-run', 'clanks-climb', 'wobble-tower'];

/** Where the hero stands in a seed's scene: feet centre and height as fractions of the thumbnail. */
export interface HeroSpot {
  x: number;
  y: number;
  h: number;
  /** The widest the hero may be (fraction of the thumbnail width). */
  maxW: number;
}

export const HERO_SPOTS: Record<StarterId, HeroSpot> = {
  'moon-king': { x: 0.225, y: 0.79, h: 0.42, maxW: 0.3 },
  'sky-run': { x: 0.18, y: 0.655, h: 0.36, maxW: 0.28 },
  'clanks-climb': { x: 0.225, y: 0.622, h: 0.34, maxW: 0.28 },
  'lantern-maze': { x: 0.35, y: 0.81, h: 0.34, maxW: 0.26 },
  'wobble-tower': { x: 0.245, y: 0.817, h: 0.4, maxW: 0.3 },
};

/** A posed picture of a character: its size and where its feet are (px in the picture). */
export interface PoseImage {
  url: string;
  w: number;
  h: number;
  footX: number;
  footY: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Places a posed character in a thumbnail: scaled so the part above its feet is `spot.h` of the
 * thumbnail (narrowed to `spot.maxW` for wide drawings), feet on the spot.
 */
export function heroRect(spot: HeroSpot, pose: Pick<PoseImage, 'w' | 'h' | 'footX' | 'footY'>, thumbW: number, thumbH: number): Rect {
  const above = Math.max(1, pose.footY);
  let s = (spot.h * thumbH) / above;
  const maxW = spot.maxW * thumbW;
  if (pose.w * s > maxW) s = maxW / Math.max(1, pose.w);
  const width = pose.w * s;
  const height = pose.h * s;
  return { left: spot.x * thumbW - pose.footX * s, top: spot.y * thumbH - pose.footY * s, width, height };
}

/** The same rect as CSS percentages of the thumbnail (so one picture serves every card size). */
export function heroRectPercent(spot: HeroSpot, pose: Pick<PoseImage, 'w' | 'h' | 'footX' | 'footY'>, aspect: number): Rect {
  const r = heroRect(spot, pose, aspect * 100, 100);
  return { left: r.left / aspect, top: r.top, width: r.width / aspect, height: r.height };
}

/** The opaque box of an RGBA image (alpha above 8), or null when empty. */
export function alphaBox(data: Uint8ClampedArray, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const POSE_W = 360;
const POSE_H = 300;
const POSE_HEIGHT = 230;
const POSE_GROUND = 0.92;

async function flatPose(flat: Blob, anchor: [number, number]): Promise<PoseImage> {
  const bmp = await createImageBitmap(flat);
  const pose = { url: URL.createObjectURL(flat), w: bmp.width, h: bmp.height, footX: anchor[0], footY: anchor[1] };
  bmp.close();
  return pose;
}

async function rigPose(flat: Blob, rig: RigData): Promise<PoseImage> {
  const { createRigPreview } = await import('../cores/rig');
  const canvas = document.createElement('canvas');
  canvas.width = POSE_W;
  canvas.height = POSE_H;
  const preview = createRigPreview(canvas, { height: POSE_HEIGHT, ground: POSE_GROUND, start: 0.5, autoplay: false });
  try {
    await preview.load(flat, rig);
    preview.pose('idle', 0.3);
  } finally {
    preview.destroy();
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  const box = alphaBox(ctx.getImageData(0, 0, POSE_W, POSE_H).data, POSE_W, POSE_H);
  if (!box) throw new Error('The pose came out empty');
  const out = document.createElement('canvas');
  out.width = box.w;
  out.height = box.h;
  out.getContext('2d')?.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The pose could not be saved');
  return { url: URL.createObjectURL(blob), w: box.w, h: box.h, footX: POSE_W / 2 - box.x, footY: POSE_H * POSE_GROUND - box.y };
}

const poses = new Map<string, Promise<PoseImage>>();

/**
 * The character at `idle`, t 0.3, cropped to its pixels (kept per drawing version). Without bones, or if
 * binding fails, the flat drawing stands in, feet on its anchor.
 */
export function renderPose(key: string, flat: Blob, rig: RigData | null, anchor: [number, number]): Promise<PoseImage> {
  let pose = poses.get(key);
  if (!pose) {
    pose = (rig ? rigPose(flat, rig).catch(() => flatPose(flat, anchor)) : flatPose(flat, anchor)).catch((err: unknown) => {
      poses.delete(key);
      throw err;
    });
    poses.set(key, pose);
  }
  return pose;
}
