import Phaser from 'phaser';
import zmEvents from '../events.js';

/**
 * Train states for the animation state machine.
 */
const TrainState = {
  IDLE: 'idle',
  DEPARTING: 'departing',
  ARRIVING: 'arriving',
};

/**
 * Train — represents a block at the station.
 *
 * Positioned in the tunnel layer (depth 10) of the scene.
 * Uses the IDLE/DEPARTING/ARRIVING state machine to prevent conflicts.
 */
class Train extends Phaser.Physics.Arcade.Sprite {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x  World x
   * @param {number} y  World y
   * @param {string} texture  Texture key
   * @param {number} scl  Scale factor
   */
  constructor(scene, x, y, texture, scl) {
    super(scene, x, y, texture);

    this.scn = scene;
    this.scaleFactor = scl;
    this.state = TrainState.IDLE;
    this.trainAnim = null;
    this.pendingDepart = false;

    this.scn.physics.world.enable(this);
    this.scn.add.existing(this);
    this.setDisplaySize((1288 / 2.67) * this.scaleFactor, (211 / 2.6) * this.scaleFactor);
    this.setDepth(10);
  }

  /**
   * Send the train departing off-screen to the right.
   */
  depart() {
    if (this.state === TrainState.DEPARTING) return;

    if (this.state === TrainState.ARRIVING) {
      this.pendingDepart = true;
      return;
    }

    this.state = TrainState.DEPARTING;
    zmEvents.emit('trainDepart');

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
   * Bring a new train arriving from the left.
   */
  arrive() {
    if (this.state === TrainState.ARRIVING) return;

    this.state = TrainState.ARRIVING;
    zmEvents.emit('trainArrive');

    this.x = -65 * 12 * this.scaleFactor;

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

        if (this.pendingDepart) {
          this.pendingDepart = false;
          this.depart();
        }
      },
    });
  }
}

export default Train;