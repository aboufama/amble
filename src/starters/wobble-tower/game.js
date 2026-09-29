// WOBBLE TOWER: stack crates as high as you can before the wobble wind knocks them down. Wobbles rides every crate.
class Game extends Amble.Scene {
  static config = {
    title: 'WOBBLE TOWER', subtitle: 'Stack it high before the wind blows it down!', physics: 'matter', gravity: 1,
    background: '#141a3a', controls: { jump: 'DROP' },
  };

  static art = {
    wobbles: { kind: 'character', rig: 'blob', role: 'hero', w: 58, h: 64, facing: 'viewer', name: 'Wobbles', ask: 'Draw Wobbles, a wobbly jelly', about: 'Rides every crate to the top of the tower.', pronoun: 'them', priority: 1 },
    dummy: { kind: 'character', rig: 'biped', role: 'npc', w: 44, h: 88, facing: 'viewer', name: 'Stickman', ask: 'Draw a stickman builder', about: 'Three of them watch your tower, and fly apart when things hit them.', pronoun: 'him', priority: 2 },
    crate: { kind: 'prop', rig: 'object', role: 'prop', shape: 'box', w: 44, h: 44, name: 'Crate', ask: 'Draw a crate to stack', about: 'Every block in the tower is one of these.', priority: 3, required: true },
    ball: { kind: 'prop', role: 'prop', shape: 'ellipse', w: 40, h: 40, name: 'Ball', ask: 'Draw a bouncy ball', about: 'Press R and a hundred of them fall.', priority: 4 },
    city: { kind: 'background', role: 'background', w: 960, h: 540, name: 'City at night', ask: 'Draw the city behind the tower', required: false, priority: 5 },
    boulder: { kind: 'prop', role: 'prop', shape: 'ellipse', w: 92, h: 92, name: 'Boulder', ask: 'Draw a boulder for the wrecking ball', spare: true },
  };

  static dials = {
    blast: { label: 'Blast power', value: 1.2, min: 0.3, max: 3, step: 0.1, words: 'boom explode bomb' },
    wind: { label: 'Wind', value: 1, min: 0, max: 4, step: 0.1, words: 'gust breeze storm blow' },
    bounce: { label: 'Bounciness', value: 0.1, min: 0, max: 0.9, step: 0.05, words: 'bouncy boing rubber' },
    gravity: { label: 'Gravity', value: 100, min: 20, max: 250, step: 5, unit: '%', words: 'heavy floaty' },
    crateSize: { label: 'Crate size', value: 44, min: 24, max: 90, step: 2, unit: 'px', words: 'big small blocks', for: 'crate' },
  };

  create() {
    this.makeSky();
    this.matter.world.setBounds(0, -600, 960, FLOOR + 600, 80, true, true, false, true);
    this.builders = [];
    this.homes = new Map();
    this.crates = [];
    this.goals = [4, 6, 8];
    this.best = this.height = this.gusts = this.windUntil = this.landedAt = 0;
    this.windDir = 1;
    this.gravityWas = 100;
    this.bounceWas = this.dials.bounce;
    for (const x of HOMES) spawnBuilder(this, x);
    this.wobbles = this.spawnHero(480, 40, 'wobbles');
    this.wobbles.setFixedRotation().setSensor(true).setStatic(true);
    this.riding = true;
    // The crane swings along the top with the next crate. Wobbles stands on it.
    this.rope = crane(this);
    this.newCrate();
    this.wreckingBall(890, 0, { key: this.hasArt('boulder') ? 'boulder' : 'ball', length: 300, radius: 46, angle: 0 });
    this.grab();
    this.impacts();
    this.meter = this.ui.text(480, 24, 'TOWER 0.0 m', { size: 24 });
    showGoal(this);
    this.ui.hint('SPACE drops a crate  ·  CLICK makes a boom  ·  DRAG anything', 6000);
    this.after(6800, () => this.ui.hint('Now try  R ball rain  ·  G gravity  ·  S slow-mo  ·  B mega bomb', 8000));
    this.music.play('chill');

    // Click empty sky to blast; click something to drag it.
    this.input.on('pointerdown', (p) => {
      if (this.matter.intersectPoint(p.worldX, p.worldY).length) return;
      const power = this.dials.blast;
      this.fx.explode(p.worldX, p.worldY, { size: power, power, radius: 140 + 90 * power });
    });
    this.input.keyboard.on('keydown-R', () => ballRain(this));
    this.input.keyboard.on('keydown-G', () => this.flipGravity());
    this.input.keyboard.on('keydown-S', () => {
      this.timeScale = this.timeScale < 1 ? 1 : 0.25;
      this.sfx('slowmo');
      this.ui.big(this.timeScale < 1 ? 'SLOW-MO' : 'FULL SPEED', { ms: 700, size: 56 });
    });
    this.input.keyboard.on('keydown-B', () => megaBomb(this));
    this.every(9000, () => gust(this));
  }

  // The city: your drawing, or the game's own stars and buildings until you draw one.
  makeSky() {
    this.sky?.forEach((layer) => layer.destroy());
    this.drawnSky = this.hasArt('city');
    this.sky = this.drawnSky ? this.parallax([{ key: 'city', y: 0, height: 540, factor: 0 }]) : this.parallax([{ draw: 'stars' }, { draw: 'city', color: '#232e5c', y: 180, height: 332 }]);
  }

  newCrate() {
    this.size = this.dials.crateSize;
    this.carry = this.add.image(this.hookX ?? 480, HOOK_Y, this.art('crate')).setDisplaySize(this.size, this.size).setDepth(200);
  }

  drop() {
    if (!this.carry || !this.cooldown('drop', 450)) return;
    const bounce = this.dials.bounce;
    const crate = this.box(this.carry.x, this.carry.y, this.size, this.size, { key: 'crate', bounce, friction: 0.9 });
    crate.setVelocity(this.hookVx, 0);
    this.crates.push(crate);
    this.carry.destroy();
    this.carry = null;
    this.sfx('blip', { pitch: 0.7 });
    // Wobbles rides the crate down...
    if (this.riding) {
      this.riding = false;
      this.wobbles.setStatic(false).setSensor(false).setFixedRotation().setVelocity(this.hookVx, 0);
      this.landedAt = this.clock;
    }
    this.after(700, () => this.newCrate());
  }

  // ...then hops back up to the crane in a big arc.
  hop() {
    this.hopFrom = { x: this.wobbles.x, y: this.wobbles.y, at: this.clock };
    this.wobbles.setStatic(true).setSensor(true);
    this.wobbles.play('jump');
    this.sfx('jump', { pitch: 1.3 });
  }

  update() {
    const x = 480 + Math.sin((this.clock / 1000) * 0.9) * 330;
    this.hookVx = (x - (this.hookX ?? x)) / 16;
    this.hookX = x;
    const standY = HOOK_Y - this.size / 2 - 33;
    this.carry?.setPosition(x, HOOK_Y);
    this.rope.setPosition(x, 0).setDisplaySize(3, HOOK_Y - this.size / 2);
    // The key press that starts the game doesn't count as a drop.
    if (this.controls.pressed('jump') && this.clock > 300) this.drop();
    if (this.riding) this.wobbles.setPosition(x, standY);
    if (!this.riding && !this.hopFrom && this.carry && this.clock - this.landedAt > 1300) this.hop();
    if (this.hopFrom) {
      const u = Math.min(1, (this.clock - this.hopFrom.at) / 600);
      this.wobbles.setPosition(Phaser.Math.Linear(this.hopFrom.x, x, u), Phaser.Math.Linear(this.hopFrom.y, standY, u) - Math.sin(u * Math.PI) * 140);
      if (u >= 1) this.hopFrom = null;
      this.riding = u >= 1;
    }
    // The wind pushes the crates while a gust lasts, stronger with every gust.
    if (this.clock < this.windUntil) {
      const push = 0.00012 * this.dials.wind * this.windDir * (1 + this.gusts * 0.15);
      for (const c of this.crates) {
        if (!c.active) continue;
        c.setAwake();
        this.matter.body.applyForce(c.body, c.body.position, { x: push * c.body.mass, y: 0 });
      }
    }
    // Builders hit hard fly apart.
    for (const b of [...this.builders]) if (b.body.speed > 6) knockBuilder(this, b, b.body.speed > 14);
    if (this.dials.gravity !== this.gravityWas) {
      this.matter.world.localWorld.gravity.y *= this.dials.gravity / this.gravityWas;
      this.gravityWas = this.dials.gravity;
    }
    if (this.dials.bounce !== this.bounceWas) {
      this.bounceWas = this.dials.bounce;
      for (const c of this.crates) if (c.active) c.setBounce(this.bounceWas);
    }
    if (this.hasArt('city') !== this.drawnSky) this.makeSky();
    if (this.cooldown('measure', 250)) measureTower(this);
  }
}
