import Phaser from 'phaser';

/**
 * Tooltip — hover popup showing transaction details.
 *
 * Appears when the user hovers over a zebra NPC, showing the txid
 * and transaction type. Fades out after the pointer leaves.
 */
class Tooltip extends Phaser.GameObjects.Container {
  /**
   * @param {Phaser.Scene} scene  The owning scene
   */
  constructor(scene) {
    super(scene);

    this.keepVisible = false;

    this.background = scene.add.rectangle(0, 0, 180, 50, 0x000000, 0.8);
    this.background.setOrigin(0.5, 0.5);

    this.text = scene.add.text(0, 0, '', {
      fontSize: '18px',
      fill: '#ffffff',
      align: 'center',
      wordWrap: { width: 320, useAdvancedWrap: true },
    });
    this.text.setOrigin(0.5, 0.5);

    this.add([this.background, this.text]);
    scene.add.existing(this);

    this.setVisible(false);

    /** @type {Phaser.Tweens.Tween|null} */
    this.fadeTween = null;
  }

  /**
   * Show the tooltip at the given position with a message.
   * @param {number} x  World x
   * @param {number} y  World y
   * @param {string} message  Text to display
   */
  show(x, y, message) {
    this.setPosition(x, y);
    this.text.setText(message);

    const textWidth = this.text.width;
    const textHeight = this.text.height;
    this.background.setSize(textWidth + 20, textHeight + 20);

    this.setAlpha(1);

    if (this.fadeTween) {
      this.fadeTween.stop();
      this.fadeTween = null;
    }

    this.adjustPosition();

    this.setDepth(1000);
    this.setVisible(true);
  }

  /**
   * Fade out and hide the tooltip.
   */
  hide() {
    if (this.keepVisible) return;

    // Guard: don't create tweens on a destroyed scene
    if (!this.scene || !this.scene.tweens) return;

    this.fadeTween = this.scene.tweens.add({
      targets: this,
      alpha: 0,
      duration: 300,
      onComplete: () => {
        this.setVisible(false);
        this.fadeTween = null;
      },
    });
  }

  /**
   * Keep the tooltip within horizontal screen bounds.
   */
  adjustPosition() {
    const screenWidth = this.scene.sys.game.config.width;
    const halfWidth = this.background.width / 2;

    if (this.x - halfWidth < 0) {
      this.setX(halfWidth);
    } else if (this.x + halfWidth > screenWidth) {
      this.setX(screenWidth - halfWidth);
    }
  }
}

export default Tooltip;