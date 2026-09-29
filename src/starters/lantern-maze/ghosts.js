// Lantern Maze's map and its ghosts' rules. The ghosts walk the maze tile by tile; at every crossing
// they pick a way: toward you when they see you, away from you when they are scared, anywhere otherwise.

const TILE = 48;
// '#' hedge · 'H' where Biscuit starts · 'L' a lantern · 'G' the ghosts' home · 'E' the gate out.
const MAZE = [
  '####################',
  '#......#....#....L.#',
  '#.###..#.##.#..###.#',
  '#.#L.#.#....#.#..#.#',
  '#.#..#...##...#.##.#',
  '#H...##.#GG#.##...L#',
  '##.#....#GG#....#.##',
  '#..#.##......##.#..#',
  '#.##..#.####.#..##.#',
  '#L...#..L.......#..E',
  '####################',
];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function openTile(c, r) {
  const ch = MAZE[r]?.[c];
  return ch !== undefined && ch !== '#' && ch !== 'E';
}

function tileOf(p) {
  return { c: Math.round((p.x - TILE / 2) / TILE), r: Math.round((p.y - TILE / 2) / TILE) };
}

/** Can the ghost see Biscuit? Close enough, and nothing but open maze in a straight line between them. */
function sees(scene, g) {
  const d = scene.dist(g, scene.player);
  if (d > scene.dials.sight) return false;
  if (d < TILE * 1.6) return true;
  const a = tileOf(g);
  const b = tileOf(scene.player);
  if (a.c !== b.c && a.r !== b.r) return false;
  const n = Math.max(Math.abs(b.c - a.c), Math.abs(b.r - a.r));
  for (let k = 1; k < n; k++) {
    if (!openTile(a.c + Math.sign(b.c - a.c) * k, a.r + Math.sign(b.r - a.r) * k)) return false;
  }
  return true;
}

/** Moves a ghost toward its next tile; at each tile centre it chooses where to go ('chase', 'flee' or 'wander'). */
function walkGhost(scene, g, speed, mode, dt) {
  if (!g.goal || scene.dist(g, g.goal) < speed * dt + 1) {
    if (g.goal) g.setPosition(g.goal.x, g.goal.y);
    const { c, r } = tileOf(g);
    const back = g.dir ?? [0, 0];
    let ways = DIRS.filter(([dx, dy]) => openTile(c + dx, r + dy) && !(dx === -back[0] && dy === -back[1]));
    if (!ways.length) ways = DIRS.filter(([dx, dy]) => openTile(c + dx, r + dy));
    const score = (d) => Math.hypot((c + d[0] + 0.5) * TILE - scene.player.x, (r + d[1] + 0.5) * TILE - scene.player.y);
    ways.sort((a, b) => score(a) - score(b));
    g.dir = mode === 'chase' ? ways[0] : mode === 'flee' ? ways[ways.length - 1] : scene.pick(ways);
    g.goal = { x: (c + g.dir[0]) * TILE + TILE / 2, y: (r + g.dir[1]) * TILE + TILE / 2 };
  }
  const a = Math.atan2(g.goal.y - g.y, g.goal.x - g.x);
  g.setVelocity(Math.cos(a) * speed, Math.sin(a) * speed);
}

/** Scared ghosts turn pale and run; touch one and it pops home for a while. */
function popGhost(scene, g) {
  scene.fx.burst(g.x, g.y, { frames: ['star', 'dot'], colors: [0xffffff, 0x9ff3ff], count: 16, speed: [60, 260], life: 500 });
  scene.addScore(200, g.x, g.y - 20);
  scene.sfx('pop');
  g.setPosition(scene.home.x, scene.home.y);
  g.goal = null;
  g.homeUntil = scene.clock + 3000;
}

/** The darkness around Biscuit: a dark sheet with a round hole of light that moves with the dog. */
function darkness(scene) {
  if (!scene.textures.exists('darkness')) {
    const tex = scene.textures.createCanvas('darkness', 2200, 1300);
    const ctx = tex.context;
    const glow = ctx.createRadialGradient(1100, 650, 70, 1100, 650, 230);
    glow.addColorStop(0, 'rgba(8, 10, 30, 0)');
    glow.addColorStop(1, 'rgba(8, 10, 30, 1)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 2200, 1300);
    tex.refresh();
  }
  return scene.add.image(0, 0, 'darkness').setDepth(700).setAlpha(0.82);
}
