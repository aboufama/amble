/**
 * Did a fill leak? The art core's gap-closing fill (§7.4) seals gaps up to about 11 board px; a gap a bit
 * wider floods the whole paper, even when, zoomed out, it looks as small as the ones Amble closes. A
 * fill that reached the paper's edge from a spot the lines almost surround (nearly every direction from
 * the tap meets a line) went out through a gap, so the Desk says so and offers Undo: "It leaked through
 * a gap." A tap on the open paper (the sky, the space beside a figure) sees open paper in many directions
 * and is left alone. Pure: the Desk hands it a small copy of the lines.
 */

export interface LeakTest {
  /** Directions tried from the tap (default 64). */
  rays?: number;
  /** How many of them may reach the paper's edge for the spot to count as surrounded (default 4). */
  open?: number;
}

/**
 * Whether the spot (x, y) is surrounded by walls: at most `open` of `rays` straight lines from it reach the
 * edge of the W×H grid without meeting a wall.
 */
export function surroundedByLines(isWall: (x: number, y: number) => boolean, W: number, H: number, x: number, y: number, o: LeakTest = {}): boolean {
  const rays = o.rays ?? 64;
  const allowed = o.open ?? 4;
  if (!(x >= 0 && y >= 0 && x < W && y < H)) return false;
  let escaped = 0;
  for (let k = 0; k < rays; k++) {
    const a = (k / rays) * Math.PI * 2;
    const dx = Math.cos(a) * 0.75;
    const dy = Math.sin(a) * 0.75;
    let px = x + dx;
    let py = y + dy;
    let hit = false;
    while (px >= 0 && py >= 0 && px < W && py < H) {
      if (isWall(Math.floor(px), Math.floor(py))) {
        hit = true;
        break;
      }
      px += dx;
      py += dy;
    }
    if (!hit && ++escaped > allowed) return false;
  }
  return true;
}
