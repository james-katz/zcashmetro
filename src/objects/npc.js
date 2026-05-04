import Phaser from 'phaser';
import zmEvents from '../events.js';

/**
 * NPC (Zebra) — represents a transaction in the mempool.
 *
 * Each zebra wanders around the station platform until its transaction
 * gets mined into a block, at which point it walks to the train and
 * boards (is destroyed).
 *
 * Animations per design guide:
 * - Body bobbing: 0.6s, 2px vertical, stepped (2 frames)
 * - Ground shadow: ellipse that pulses with the bob
 * - Shield float: 2.2s ease-in-out, 2px vertical
 * - Flip: scaleX based on movement direction
 */
class NPC extends Phaser.GameObjects.Container {
  /**
   * @param {Phaser.Scene} scene
   * @param {{ txid: string, type: string }} tx  Transaction data
   * @param {number} x  World x position
   * @param {number} y  World y position
   * @param {number} scl  Scale factor
   */
  constructor(scene, tx, x, y, scl) {
    super(scene, x, y);

    this.isPlaying = false;
    this.canWander = false;
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

    // Ground shadow (drawn first, behind everything)
    this.shadow = this.scn.add.ellipse(0, 14 * scl, 36 * scl, 4 * scl, 0x000000, 0.5);
    this.add(this.shadow);

    // Zebra sprite
    this.zebra = this.scn.add.sprite(0, 0, 'zebra');
    this.zebra.setDisplaySize(24 * this.scaleFactor, 24 * this.scaleFactor);
    this.add(this.zebra);

    // Shield badge
    if (this.shieldTexture) {
      this.shield = this.scn.add.sprite(10 * scl, 8 * scl, this.shieldTexture);
      this.shield.setDisplaySize(16 * this.scaleFactor, 16 * this.scaleFactor);
      this.add(this.shield);
    }

    this.scn.add.existing(this);
    this.setDepth(22);

    // Interactive hit area
    this.setSize(this.zebra.displayWidth, this.zebra.displayHeight);
    this.setInteractive({ useHandCursor: true });

    // --- Animations ---
    this.startBobAnimation();
    if (this.shield) {
      this.startShieldFloat();
    }

    // --- Events → DOM overlays ---
    this.on('pointerover', () => {
      const camera = this.scn.cameras.main;
      const screenX = (this.x - camera.scrollX) * camera.zoom;
      const screenY = (this.y - camera.scrollY) * camera.zoom + 60; // +60 for navbar
      zmEvents.emit('npcHover', {
        txid: this.txid,
        txType: this.txType,
        typeText: this.typeText,
        screenX,
        screenY,
      });
    });

    this.on('pointerout', () => {
      zmEvents.emit('npcHoverEnd');
    });

    this.on('pointerdown', () => {
      zmEvents.emit('npcClick', {
        txid: this.txid,
        txType: this.txType,
        typeText: this.typeText,
      });
    });
  }

  /**
   * Bobbing animation — 2px vertical oscillation, stepped.
   */
  startBobAnimation() {
    if (this.isDestroyed) return;
    this.bobTween = this.scn.tweens.add({
      targets: this.zebra,
      y: -2 * this.scaleFactor,
      duration: 300,
      yoyo: true,
      repeat: -1,
      ease: 'Stepped',
      easeParams: [2],
    });

    // Shadow pulses in sync
    this.shadowTween = this.scn.tweens.add({
      targets: this.shadow,
      scaleX: 0.85,
      alpha: 0.7,
      duration: 300,
      yoyo: true,
      repeat: -1,
      ease: 'Stepped',
      easeParams: [2],
    });
  }

  /**
   * Shield float animation — 2.2s ease-in-out, 2px vertical.
   */
  startShieldFloat() {
    if (this.isDestroyed || !this.shield) return;
    this.shieldTween = this.scn.tweens.add({
      targets: this.shield,
      y: (8 - 2) * this.scaleFactor,
      duration: 1100,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /**
   * Stop any currently playing movement tween.
   */
  stopCurrentTween() {
    if (this.isDestroyed) return;
    const tweens = this.scn.tweens.getTweensOf(this);
    for (const tw of tweens) {
      // Don't stop the bob/shadow/shield tweens
      if (tw === this.bobTween || tw === this.shadowTween || tw === this.shieldTween) continue;
      if (tw.isPlaying()) {
        tw.stop();
        tw.destroy();
      }
    }
    this.isPlaying = false;
  }

  /**
   * Animate this NPC along a BFS path.
   * @param {object[]} path  Array of tile objects from BFS
   * @param {boolean} rush  If true, move fast (boarding) and destroy on arrival
   * @param {Function} [onComplete]  Callback after tween finishes
   */
  moveAlongPath(path, rush, onComplete) {
    if (this.isDestroyed) {
      if (onComplete) onComplete();
      return;
    }

    if (!path || path.length <= 1) {
      this.isPlaying = false;
      this.canWander = !rush;
      if (rush) this.cleanup();
      if (onComplete) onComplete();
      return;
    }

    this.stopCurrentTween();
    this.isPlaying = true;
    this.canWander = false;

    const speed = rush ? 20 : 60;

    // Determine overall direction for flip
    const lastTile = path[path.length - 1];
    const firstTile = path[0];
    if (lastTile.x < firstTile.x) {
      this.zebra.setFlipX(true);
    } else if (lastTile.x > firstTile.x) {
      this.zebra.setFlipX(false);
    }

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
          // Boarding animation: shrink + fade before cleanup
          this.boardingExit(() => {
            if (onComplete) onComplete();
          });
        } else {
          if (onComplete) onComplete();
        }
      },
    });
  }

  /**
   * Play a shrink + fade animation when the NPC boards the train.
   * The NPC shrinks to 0.2 scale and fades to 0 alpha over 400ms,
   * then is destroyed.
   * @param {Function} [onComplete]  Callback after animation + destroy
   */
  boardingExit(onComplete) {
    if (this.isDestroyed) {
      if (onComplete) onComplete();
      return;
    }

    this.canWander = false;
    this.isPlaying = true;

    // Stop the bobbing while boarding exit plays
    if (this.bobTween) { this.bobTween.pause(); }
    if (this.shadowTween) { this.shadowTween.pause(); }
    if (this.shieldTween) { this.shieldTween.pause(); }

    this.scn.tweens.add({
      targets: this,
      scaleX: 0.2,
      scaleY: 0.2,
      alpha: 0,
      duration: 400,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.cleanup();
        if (onComplete) onComplete();
      },
    });
  }

  /**
   * Safely destroy this NPC and all its tweens.
   */
  cleanup() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.canWander = false;
    this.isPlaying = false;

    // Stop animation tweens
    if (this.bobTween) { this.bobTween.destroy(); this.bobTween = null; }
    if (this.shadowTween) { this.shadowTween.destroy(); this.shadowTween = null; }
    if (this.shieldTween) { this.shieldTween.destroy(); this.shieldTween = null; }

    this.destroy();
  }
}

export default NPC;