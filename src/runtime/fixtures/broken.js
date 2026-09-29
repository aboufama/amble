// A typical mistake: update() uses this.enemy, which create() never made (line 13).
class Game extends Amble.Scene {
  static config = { physics: 'arcade', gravity: 1200, background: '#16213e' };
  create() {
    this.level(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '##############################', '##############################']);
    this.player = this.spawnHero(200, 300, 'hero').platformer();
    this.ui.hint('Walk right...');
    this.frames = 0;
  }
  update() {
    this.frames++;
    if (this.frames > 20) {
      this.enemy.x += 2;
    }
  }
}
