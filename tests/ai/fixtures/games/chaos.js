// CRASH LAB: a physics toy. Smash towers with a wrecking ball, blow things up, rain hundreds of balls, flip gravity.
class Game extends Amble.Scene {
  static config = { title: 'CRASH LAB', subtitle: 'Break everything!', physics: 'matter', gravity: 1, background: '#1a2233' };
  static art = {
    crate: { kind: 'prop', w: 40, h: 40, color: '#d4a373', ask: 'Draw a wooden crate' },
    plank: { kind: 'prop', w: 120, h: 18, color: '#b08968', ask: 'Draw a long plank' },
    ball: { kind: 'prop', shape: 'ellipse', w: 24, h: 24, color: '#f4f1ea', ask: 'Draw a bouncy ball' },
    wreckingball: { kind: 'prop', shape: 'ellipse', w: 90, h: 90, color: '#4a4e69', ask: 'Draw a giant wrecking ball' },
    dummy: { kind: 'character', rig: 'biped', w: 44, h: 84, role: 'npc', color: '#ffd166', ask: 'Draw a crash-test dummy' },
    ground: { kind: 'terrain', color: '#3d4a5c', top: '#7d8ba3' },
  };

  create() {
    this.parallax([{ draw: 'city', color: '#232e46', factor: 0, y: 150, height: 350 }]);
    this.matter.world.setBounds(0, 0, 960, 500, 80);
    this.add.tileSprite(480, 520, 960, 40, this.art('ground')).setDepth(150);

    for (let level = 0; level < 4; level++) {
      const y = 500 - level * 58;
      this.box(130, y - 20, 40, 40);
      this.box(190, y - 20, 40, 40);
      this.box(160, y - 49, 120, 18, { key: 'plank' });
    }
    this.stack(560, 500, 3, 7);
    this.pyramid(800, 500, 6, { w: 36, h: 36 });
    this.ragdoll(160, 200, 'dummy');
    this.ragdoll(560, 170, 'dummy');
    this.ragdoll(800, 240, 'dummy');

    this.wreckingBall(330, 30, { length: 300, radius: 45, angle: -62 });
    this.grab();
    this.impacts();
    this.balls = [];

    this.info = this.ui.text(20, 18, '', { originX: 0, originY: 0, size: 20 });
    this.ui.hint('CLICK: boom!   DRAG: grab   R: ball rain   G: flip gravity   S: slow-mo   B: MEGA BOMB', 9000);

    this.input.on('pointerdown', (p) => {
      if (this.matter.intersectPoint(p.worldX, p.worldY).length) return; // grabbing something instead
      this.boom(p.worldX, p.worldY, 1.2);
    });
    const keys = this.input.keyboard;
    keys.on('keydown-R', () => this.rain(150));
    keys.on('keydown-G', () => this.flipGravity());
    keys.on('keydown-S', () => {
      this.timeScale = this.timeScale < 1 ? 1 : 0.25;
      this.sfx('slowmo');
      this.ui.big(this.timeScale < 1 ? 'SLOW-MO' : 'FULL SPEED', { ms: 700, size: 56 });
    });
    keys.on('keydown-B', () => this.megaBomb());
  }

  boom(x, y, size) {
    this.fx.explode(x, y, { size, power: size, radius: 140 + 90 * size });
  }

  rain(count) {
    this.ui.big('BALL RAIN!', { ms: 800, size: 60, color: '#4cc9f0' });
    for (let i = 0; i < count; i++) {
      this.after(i * 10, () => {
        const b = this.ball(this.rand(40, 920), this.rand(20, 70), this.rand(8, 16), { bounce: 0.6 });
        b.setTint(this.pick([0x4cc9f0, 0xffd23f, 0xff5d73, 0x7ddf8c, 0xc77dff]));
        this.balls.push(b);
        if (this.balls.length > 320) this.balls.shift().destroy();
      });
    }
  }

  megaBomb() {
    const p = this.input.activePointer;
    const x = p.worldX || 480, y = p.worldY || 300;
    this.ui.big('MEGA BOMB', { ms: 700, color: '#ff8c42' });
    this.fx.slowmo(0.2, 1100);
    this.after(120, () => {
      this.boom(x, y, 2.6);
      this.fx.flash('#ffffff', 220, 0.7);
    });
  }

  update() {
    this.info.setText(`BODIES: ${this.matter.getMatterBodies().length}   ${this.gravityFlipped ? 'GRAVITY: UP!' : ''}`);
  }
}
