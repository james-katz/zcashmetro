import Phaser from 'phaser';

class Train extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, texture, scl) {
    super(scene, x, y, texture);
    
    this.scn = scene;
    this.scaleFactor = scl;

    // Add the train to the scene's physics engine
    this.scn.physics.world.enable(this);
    this.scn.add.existing(this);

    // Set any custom properties or behaviors here
    // this.setCollideWorldBounds(true);    
    this.setDisplaySize(1288/2.67 * this.scaleFactor, 211/2.6 * this.scaleFactor);
  }

  // You can add custom methods for the train here
  depart() {     
    if(this.trainAnim) return;
    this.trainAnim = this.scn.tweens.chain({
      targets: this,      
      tweens: [
        {
        x: (75 * 12) * this.scaleFactor,
        // y: (10 * 12) * this.scaleFactor,
        ease: 'Quad.easeInOut',
        duration: 2000,   
        repeat: false,
        loop: false,
        delay: 1500
      }
    ],
    onComplete: () => {
      this.trainAnim.destroy();
      this.trainAnim = undefined;
      this.arrive();      
    }
    });
  }

  arrive() {   
    if(this.trainAnim) return;
    this.x = -65 * 12 * this.scaleFactor;        
    this.trainAnim = this.scn.tweens.chain({
      targets: this,      
      tweens: [
        {
        x: (22 * 12) * this.scaleFactor,
        // y: (10 * 12) * this.scaleFactor,
        ease: 'Quad.easeOut',
        duration: 3000,      
        // delay: 200
      }
    ],
    onComplete: () => {
      // this.trainAnim.stop();   
      this.trainAnim.destroy();
      this.trainAnim = undefined;   
    }
    });
  }
}

export default Train;