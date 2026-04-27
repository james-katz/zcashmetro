import Phaser from 'phaser';

/**
 * Sign — a station information display (block height, mempool count, etc.).
 */
class Sign extends Phaser.GameObjects.Container {
  /**
   * @param {Phaser.Scene} scene  The owning scene
   * @param {number} x  World x position
   * @param {number} y  World y position
   * @param {string} text  Initial display text
   * @param {number} scl  Scale factor
   */
  constructor(scene, x, y, text, scl) {
    super(scene, x, y);

    this.background = scene.add.rectangle(0, 0, 128 * scl, 60 * scl, 0x000000, 0.85);
    this.background.setOrigin(0.5, 0.5);

    this.text = scene.add.text(0, 0, text, {
      fontSize: `${14 * scl}px`,
      fill: '#ffffff',
      align: 'center',
      wordWrap: { width: 320, useAdvancedWrap: true },
    });
    this.text.setOrigin(0.5, 0.5);

    this.add([this.background, this.text]);
    scene.add.existing(this);
  }

  /**
   * Update the sign text.
   * @param {string} newText
   */
  updateText(newText) {
    this.text.setText(newText);
    this.text.setOrigin(0.5, 0.5);
  }
}

export default Sign;