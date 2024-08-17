import Phaser from 'phaser';
import Tooltip from './tooltip';

class NPC extends Phaser.GameObjects.Container {
  constructor(scene, tx, x, y, scl) {
    super(scene, x, y);       

    this.scn = scene;
    this.scaleFactor = scl;

    this.txid = tx.txid;    
    this.type = tx.type;
    this.typeText = "Transparent";
    this.shieldTexture;
    if(this.type == "t2z" || this.type == "t2o") {
      this.shieldTexture = 'bronze';
      this.typeText = "Shielding";
    }
    else if(this.type == "z2t" || this.type == "o2t") {
      this.shieldTexture = 'bronze';
      this.typeText = "Deshielding";
    }
    else if(this.type == "z2o" || this.type == "o2z") {
      this.shieldTexture = 'silver';
      this.typeText = "Partially Shielded";
    }
    else if(this.type == "z2z" || this.type == "o2o") {
      this.shieldTexture = 'gold';
      this.typeText = "Fully Shielded";
    }

    // Add this NPC to the scene's physics engine
    // this.scn.physics.world.enable(this);
    
    this.zebra = this.scn.add.sprite(0, 0, 'zebra');
    this.zebra.setDisplaySize(24 * this.scaleFactor, 24 * this.scaleFactor);
    this.add(this.zebra);    

    // Put a shield image
    if(this.shieldTexture) {
      this.shield = this.scn.add.sprite(16, 20, this.shieldTexture);
      this.shield.setDisplaySize(16 * this.scaleFactor, 16 * this.scaleFactor);
      this.add(this.shield);
    }

    this.scn.add.existing(this);

    // Set any custom properties or behaviors here
    // this.setCollideWorldBounds(true);
    // this.setDisplaySize(24 * this.scaleFactor, 24 * this.scaleFactor);

    // Enable input on this sprite
    this.setSize(this.zebra.displayWidth, this.zebra.displayHeight); // Set the container's hitbox size
    this.setInteractive();
    
    // Create tooltip instance
    this.tooltip = new Tooltip(scene);

    // Event listeners for hover and click
    this.on('pointerover', () => {
      this.tooltip.show(this.x, this.y - 96, `Transaction ID:\n${this.txid}\n\nType: ${this.typeText} `);
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
          this.scn.events.emit('done');
        }
      }
    });
  }
}

export default NPC;