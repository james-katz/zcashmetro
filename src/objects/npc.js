import Phaser from 'phaser';
import Tooltip from './tooltip';

class NPC extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, txid, x, y, texture, scl) {
    super(scene, x, y, texture);
    
    this.scn = scene;
    this.scaleFactor = scl;

    this.txid = txid;    

    // Add this NPC to the scene's physics engine
    this.scn.physics.world.enable(this);
    this.scn.add.existing(this);

    // Set any custom properties or behaviors here
    // this.setCollideWorldBounds(true);
    this.setDisplaySize(24 * this.scaleFactor, 24 * this.scaleFactor);

    // Enable input on this sprite
    this.setInteractive();

    // Create tooltip instance
    this.tooltip = new Tooltip(scene);

    // Event listeners for hover and click
    this.on('pointerover', () => {
      this.tooltip.show(this.x, this.y - 64, `${this.txid}`);
    });

    this.on('pointerout', () => {
      this.tooltip.hide();
    });

    this.on('pointerdown', () => {
      window.open(`https://mainnet.zcashexplorer.app/transactions/${this.txid}`, '_blank');
    });
  }

  // You can add custom methods for the NPC here
  moveAlongPath(path, rush) {    
    const speed = rush ? 20 : 60;
    this.scn.tweens.chain({
      targets: this,
      ease: 'linear',
    //   duration: 20,      
      tweens: path.map(p => ({
        x: (p.x * 12 + (p.x < 24 ? 12 : 0)) * this.scaleFactor,
        y: (p.y * 12) * this.scaleFactor,
        duration: speed - Math.random() * 20
      })),
      onComplete: () => {
        if(rush) {
          this.tooltip.destroy();          
          this.destroy();
        }
      }
    });
  }
}

export default NPC;