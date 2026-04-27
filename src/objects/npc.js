import Phaser from 'phaser';
import Tooltip from './tooltip';

/**
 * NPC (Zebra) — represents a transaction in the mempool.
 *
 * Each zebra wanders around the station platform until its transaction
 * gets mined into a block, at which point it walks to the train and
 * boards (is destroyed).
 */
class NPC extends Phaser.GameObjects.Container {
  /**
   * @param {Phaser.Scene} scene  The owning scene
   * @param {{ txid: string, type: string }} tx  Transaction data
   * @param {number} x  World x position
   * @param {number} y  World y position
   * @param {number} scl  Scale factor
   */
  constructor(scene, tx, x, y, scl) {
    super(scene, x, y);

    /** @type {boolean} Whether a tween is currently playing on this NPC. */
    this.isPlaying = false;

    /** @type {boolean} Whether this NPC is allowed to wander randomly. */
    this.canWander = false;

    /** @type {boolean} Set to true once destroy() has been called. */
    this.isDestroyed = false;

    this.scn = scene;
    this.scaleFactor = scl;

    this.txid = tx.txid;
    this.txType = tx.type;
    this.typeText = 'Transparent';
    this.shieldTexture = undefined;

    if (this.txType === 't2z' || this.txType === 't2o') {
      this.shieldTexture = 'bronze';
      this.typeText = 'Shielding';
    } else if (this.txType === 'z2t' || this.txType === 'o2t') {
      this.shieldTexture = 'bronze';
      this.typeText = 'Deshielding';
    } else if (this.txType === 'z2o' || this.txType === 'o2z') {
      this.shieldTexture = 'silver';
      this.typeText = 'Partially Shielded';
    } else if (this.txType === 'z2z' || this.txType === 'o2o') {
      this.shieldTexture = 'gold';
      this.typeText = 'Fully Shielded';
    }

    // Zebra sprite
    this.zebra = this.scn.add.sprite(0, 0, 'zebra');
    this.zebra.setDisplaySize(24 * this.scaleFactor, 24 * this.scaleFactor);
    this.add(this.zebra);

    // Shield badge (if shielded tx)
    if (this.shieldTexture) {
      this.shield = this.scn.add.sprite(16, 20, this.shieldTexture);
      this.shield.setDisplaySize(16 * this.scaleFactor, 16 * this.scaleFactor);
      this.add(this.shield);
    }

    this.scn.add.existing(this);

    // Interactive hit area
    this.setSize(this.zebra.displayWidth, this.zebra.displayHeight);
    this.setInteractive();

    // Tooltip for hover info
    this.tooltip = new Tooltip(scene);

    this.on('pointerover', () => {
      this.tooltip.show(
        this.x,
        this.y - 96,
        `Transaction ID:\n${this.txid}\n\nType: ${this.typeText} `
      );
    });

    this.on('pointerout', () => {
      this.tooltip.hide();
    });

    this.on('pointerdown', () => {
      window.open(
        `https://mainnet.zcashexplorer.app/transactions/${this.txid}`,
        '_blank'
      );
    });
  }

  /**
   * Stop any currently playing tween on this NPC.
   * Safe to call even if no tweens are active.
   */
  stopCurrentTween() {
    if (this.isDestroyed) return;
    const tweens = this.scn.tweens.getTweensOf(this);
    for (const tw of tweens) {
      if (tw.isPlaying()) {
        tw.stop();
        tw.destroy();
      }
    }
    this.isPlaying = false;
  }

  /**
   * Animate this NPC along a BFS path.
   *
   * @param {object[]} path  Array of tile objects from BFS
   * @param {boolean} rush  If true, move fast (boarding train) and destroy on arrival
   * @param {Function} [onComplete]  Callback invoked after the tween chain finishes
   */
  moveAlongPath(path, rush, onComplete) {
    if (this.isDestroyed) {
      if (onComplete) onComplete();
      return;
    }

    // If path is empty or trivial, skip animation
    if (!path || path.length <= 1) {
      this.isPlaying = false;
      this.canWander = !rush;
      if (rush) {
        this.cleanup();
      }
      if (onComplete) onComplete();
      return;
    }

    // Stop any existing movement tween before starting a new one
    this.stopCurrentTween();

    this.isPlaying = true;
    this.canWander = false;

    const speed = rush ? 20 : 60;

    this.scn.tweens.chain({
      targets: this,
      ease: 'linear',
      tweens: path.map((p) => ({
        x: (p.x * 12 + (p.x < 24 ? 12 : 0)) * this.scaleFactor,
        y: p.y * 12 * this.scaleFactor,
        duration: speed - Math.random() * 20,
      })),
      onComplete: () => {
        this.isPlaying = false;
        this.canWander = true;

        if (rush) {
          this.cleanup();
        }

        if (onComplete) onComplete();
      },
    });
  }

  /**
   * Safely destroy this NPC and its tooltip. Guards against double-destroy.
   */
  cleanup() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.canWander = false;
    this.isPlaying = false;

    if (this.tooltip) {
      this.tooltip.destroy();
      this.tooltip = null;
    }

    this.destroy();
  }
}

export default NPC;