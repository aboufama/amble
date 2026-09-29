// A plain Phaser 3 game, the way tutorials write it: images from files, its own Phaser.Game.
class StarScene extends Phaser.Scene {
  preload() {
    this.load.image('sky', 'assets/sky.png');
    this.load.image('star', 'assets/star.png');
    this.load.spritesheet('dude', 'assets/dude.png', { frameWidth: 32, frameHeight: 48 });
    this.load.audio('ding', 'assets/ding.mp3');
  }

  create() {
    this.add.image(400, 300, 'sky');
    this.stars = this.physics.add.group({ key: 'star', repeat: 9, setXY: { x: 40, y: 0, stepX: 80 } });
    this.stars.children.iterate((s) => s.setBounceY(Phaser.Math.FloatBetween(0.4, 0.8)).setCollideWorldBounds(true));
    this.player = this.physics.add.sprite(100, 450, 'dude').setCollideWorldBounds(true).setBounce(0.2);
    this.cursors = this.input.keyboard.createCursorKeys();
    this.score = 0;
    this.scoreText = this.add.text(16, 16, 'Score: 0', { fontSize: '28px', color: '#ffffff' });
    this.physics.add.overlap(this.player, this.stars, (p, star) => {
      star.disableBody(true, true);
      this.score += 10;
      this.scoreText.setText('Score: ' + this.score);
      this.sound.play('ding');
    });
  }

  update() {
    const c = this.cursors;
    if (c.left.isDown) this.player.setVelocityX(-160);
    else if (c.right.isDown) this.player.setVelocityX(160);
    else this.player.setVelocityX(0);
    if (c.up.isDown && this.player.body.blocked.down) this.player.setVelocityY(-330);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: '#223355',
  physics: { default: 'arcade', arcade: { gravity: { y: 300 } } },
  scene: StarScene,
});
