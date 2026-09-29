// LANTERN MAZE: find every lantern in the dark hedge maze. Each one scares the ghosts, so you can pop them!
class Game extends Amble.Scene {
  static config = {
    title: 'LANTERN MAZE', subtitle: 'Find every lantern. Scare the ghosts!', physics: 'arcade', gravity: 0,
    background: '#0f1629',
  };

  static art = {
    hero: { kind: 'character', rig: 'quadruped', role: 'hero', w: 54, h: 44, facing: 'right', name: 'Biscuit', ask: 'Draw your hero, maybe a dog', about: 'Trots through the maze, finding lanterns.', pronoun: 'them', priority: 1 },
    boo: { kind: 'character', rig: 'blob', role: 'enemy', w: 40, h: 42, name: 'Boo', ask: 'Draw Boo, a spooky-cute ghost', about: 'Four of them wander the maze and chase you when they see you.', pronoun: 'them', priority: 2 },
    lantern: { kind: 'item', role: 'item', w: 36, h: 36, name: 'Lantern', ask: 'Draw a glowing lantern', about: 'Each one you find scares the ghosts.', priority: 3 },
    key: { kind: 'item', role: 'item', w: 32, h: 32, name: 'Key', ask: 'Draw the key to the gate', about: 'It appears when every lantern is lit.', priority: 4 },
    wall: { kind: 'terrain', role: 'terrain', w: 48, h: 48, color: '#2c6a3c', top: '#56b565', name: 'Hedge', ask: 'Draw a piece of hedge, seen from above', priority: 5 },
    pal: { kind: 'character', rig: 'biped', role: 'npc', w: 34, h: 56, facing: 'right', name: 'Pal', ask: 'Draw Pal, a friend who follows you', spare: true },
  };

  static dials = {
    speed: { label: 'Speed', value: 230, min: 120, max: 400, step: 10, words: 'fast quick run', for: 'hero' },
    ghostSpeed: { label: 'Ghost speed', value: 110, min: 40, max: 260, step: 10, words: 'ghosts fast slow', for: 'boo' },
    scared: { label: 'Scared time', value: 5, min: 1, max: 15, step: 1, unit: 's', words: 'scare fright lantern', for: 'boo' },
    sight: { label: 'Ghost sight', value: 260, min: 60, max: 600, step: 20, unit: 'px', words: 'see notice eyes', for: 'boo' },
  };

  create() {
    this.lanterns = 0;
    this.scaredUntil = 0;
    this.ghosts = [];
    this.spots = [];
    // The maze: '#' becomes hedge, and each letter puts something in its place.
    this.level(MAZE, {
      tile: TILE,
      legend: {
        '#': 'wall',
        H: (x, y) => (this.start = { x, y }),
        L: (x, y) => this.addLantern(x, y),
        G: (x, y) => this.spots.push({ x, y }),
        E: (x, y) => (this.gate = this.platform(x, y, TILE, TILE, 'wall')),
      },
    });
    this.home = { x: 10 * TILE, y: 6 * TILE };
    this.player = this.spawnHero(this.start.x, this.start.y, 'hero', { hp: 3, hitbox: 0.55, hitboxH: 0.7 }).topdown({ speed: () => this.dials.speed });
    this.ui.hearts(this.player);
    for (const s of this.spots) this.addGhost(s.x, s.y);
    this.dark = darkness(this);
    this.trail = [];
    if (this.hasArt('pal')) this.pal = this.spawn(this.start.x, this.start.y, 'pal', { role: 'npc', body: false });
    this.overlap(this.player, 'enemies', (h, g) => this.clock < this.scaredUntil && popGhost(this, g));
    this.music.play('spooky');
    this.ui.hint('ARROWS walk  ·  find every lantern  ·  a lantern scares the ghosts: pop them!');
  }

  addLantern(x, y) {
    const l = this.spawnItem(x, y, 'lantern', { points: 50, float: 4, onPickup: () => this.lightUp() });
    this.fx.halo(l, 0xffc15e, 3);
  }

  // Each ghost has a brain: wander, chase you when it sees you, run away when a lantern scares it.
  addGhost(x, y) {
    const g = this.spawnEnemy(x, y, 'boo', { hp: 1, gravity: false });
    g.setAlpha(0.9);
    this.ghosts.push(g);
    this.brain(g, {
      wander: { update: (g, dt, b) => this.ghostStep(g, dt, b, 'wander', 0.8) },
      chase: { update: (g, dt, b) => this.ghostStep(g, dt, b, 'chase', 1) },
      scared: { update: (g, dt, b) => this.ghostStep(g, dt, b, 'flee', 0.6) },
    }, 'wander');
  }

  ghostStep(g, dt, brain, mode, pace) {
    if (this.clock < g.homeUntil) return g.setVelocity(0, 0);
    const scared = this.clock < this.scaredUntil;
    const want = scared ? 'scared' : sees(this, g) ? 'chase' : 'wander';
    if (brain.state !== want) brain.go(want);
    g.contactDamage = scared ? 0 : 1;
    g.setTint(scared ? 0x9ff3ff : 0xffffff);
    walkGhost(this, g, this.dials.ghostSpeed * pace, mode, dt);
  }

  // A lantern: the maze gets a little lighter, and every ghost is scared for a while.
  lightUp() {
    this.lanterns++;
    this.scaredUntil = this.clock + this.dials.scared * 1000;
    this.dark.setAlpha(Math.max(0.35, this.dark.alpha - 0.1));
    this.fx.flash('#ffc15e', 160, 0.3);
    this.ui.big('BOO!', { sub: 'The ghosts are scared: pop them!', color: '#9ff3ff', ms: 900 });
    this.sfx('powerup');
    if (this.all('items').length > 1) return;
    // The last lantern: the key appears in the ghosts' home.
    const key = this.spawnItem(this.home.x, this.home.y, 'key', { float: 6, points: 200, onPickup: () => this.openGate() });
    this.fx.halo(key, 0xffd23f, 3);
    this.ui.big('THE KEY!', { sub: 'It is in the ghosts\' home...', color: '#ffd23f' });
  }

  openGate() {
    this.fx.burst(this.gate.x, this.gate.y, { frames: ['square', 'dot'], colors: [0x56b565, 0x2c6a3c], count: 30, speed: [80, 320], life: 700 });
    this.gate.destroy();
    this.ui.big('THE GATE IS OPEN!', { sub: 'Run out on the right!', color: '#86f3cb' });
    this.sfx('explosion');
  }

  update() {
    const p = this.player;
    this.dark.setPosition(p.x, p.y);
    // Pal walks where you walked, a few steps behind.
    this.trail.push({ x: p.x, y: p.y, f: p.facing });
    if (this.trail.length > 24) {
      const t = this.trail.shift();
      this.pal?.setPosition(t.x, t.y).face(t.f);
    }
    if (p.alive && p.x > 925) {
      p.alive = false;
      this.win('YOU FOUND THE WAY OUT!');
    }
  }
}
