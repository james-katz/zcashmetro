import Phaser from 'phaser';

/**
 * Train states for the animation state machine.
 * @enum {string}
 */
const TrainState = {
  IDLE: 'idle',
  DEPARTING: 'departing',
  ARRIVING: 'arriving',
};

/**
 * Train — represents a block at the station.
 *
 * The train sits at the platform while transactions (zebras) board.
 * When all mined transactions have boarded, it departs off-screen,
 * then a new train arrives from the opposite side.
 */
class Train extends Phaser.Physics.Arcade.Sprite {
  /**
   * @param {Phaser.Scene} scene  The owning scene
   * @param {number} x  World x position
   * @param {number} y  World y position
   * @param {string} texture  Texture key
   * @param {number} scl  Scale factor
   */
  constructor(scene, x, y, texture, scl) {
    super(scene, x, y, texture);

    this.scn = scene;
    this.scaleFactor = scl;

    /** @type {string} Current animation state. */
    this.state = TrainState.IDLE;

    /** @type {Phaser.Tweens.TweenChain|null} Active tween animation. */
    this.trainAnim = null;

    /** @type {boolean} Whether a departure was requested while arriving. */
    this.pendingDepart = false;

    // Add the train to the scene
    this.scn.physics.world.enable(this);
    this.scn.add.existing(this);
    this.setDisplaySize((1288 / 2.67) * this.scaleFactor, (211 / 2.6) * this.scaleFactor);
  }

  /**
   * Send the train departing off-screen to the right.
   * If the train is currently arriving, queues the departure.
   * If already departing, this is a no-op.
   */
  depart() {
    if (this.state === TrainState.DEPARTING) return;

    if (this.state === TrainState.ARRIVING) {
      // Queue departure for after arrival completes
      this.pendingDepart = true;
      return;
    }

    this.state = TrainState.DEPARTING;

    // Clean up any leftover tween
    if (this.trainAnim) {
      this.trainAnim.destroy();
      this.trainAnim = null;
    }

    this.trainAnim = this.scn.tweens.chain({
      targets: this,
      tweens: [
        {
          x: 75 * 12 * this.scaleFactor,
          ease: 'Quad.easeInOut',
          duration: 2000,
          repeat: false,
          loop: false,
          delay: 80,
        },
      ],
      onComplete: () => {
        if (this.trainAnim) {
          this.trainAnim.destroy();
          this.trainAnim = null;
        }
        this.state = TrainState.IDLE;
        this.arrive();
      },
    });
  }

  /**
   * Bring a new train arriving from the left side of the screen.
   * Automatically called after departure completes.
   */
  arrive() {
    if (this.state === TrainState.ARRIVING) return;

    this.state = TrainState.ARRIVING;

    // Start off-screen to the left
    this.x = -65 * 12 * this.scaleFactor;

    // Clean up any leftover tween
    if (this.trainAnim) {
      this.trainAnim.destroy();
      this.trainAnim = null;
    }

    this.trainAnim = this.scn.tweens.chain({
      targets: this,
      tweens: [
        {
          x: 22 * 12 * this.scaleFactor,
          ease: 'Quad.easeOut',
          duration: 3000,
        },
      ],
      onComplete: () => {
        if (this.trainAnim) {
          this.trainAnim.destroy();
          this.trainAnim = null;
        }
        this.state = TrainState.IDLE;

        // If a departure was requested while we were arriving, go now
        if (this.pendingDepart) {
          this.pendingDepart = false;
          this.depart();
        }
      },
    });
  }
}

export default Train;