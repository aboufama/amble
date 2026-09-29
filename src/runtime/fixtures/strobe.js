// A game that asks for a seizure-risk strobe: five white camera flashes and a black/white background swap
// every frame, and red fx flashes on top. The player's flash limiter must keep it to 3 flashes a second.
class Game extends Amble.Scene {
  static config = { physics: 'none', background: '#000000' };
  create() {
    this.n = 0;
    this.add.text(480, 270, 'STROBE TEST', { fontSize: '48px', color: '#888888' }).setOrigin(0.5);
  }
  update() {
    this.n++;
    for (let i = 0; i < 5; i++) this.cameras.main.flash(40, 255, 255, 255, true);
    this.cameras.main.setBackgroundColor(this.n % 2 ? '#ffffff' : '#000000');
    this.fx.flash(0xff0000, 60, 1);
  }
}
