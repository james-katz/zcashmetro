class Tooltip extends Phaser.GameObjects.Container {
    constructor(scene) {
        super(scene);        

        this.keepVisible = false;

        // Create the background rectangle for the tooltip
        this.background = scene.add.rectangle(0, 0, 150, 50, 0x000000, 0.8);
        this.background.setOrigin(0.5, 0.5);

        // Create the text for the tooltip
        this.text = scene.add.text(0, 0, '', {
        fontSize: '18px',
        fill: '#ffffff',
        align: 'center',
        wordWrap: { width: 256, useAdvancedWrap: true }
        });
        this.text.setOrigin(0.5, 0.5);

        // Add background and text to the container
        this.add([this.background, this.text]);

        // Add this container to the scene
        scene.add.existing(this);  

        // Hide the tooltip initially
        this.setVisible(false);
    }
  
    show(x, y, message) {
        this.setPosition(x, y);
        this.text.setText(message);

        // Adjust the background size based on the text size
        const textWidth = this.text.width;
        const textHeight = this.text.height;
        this.background.setSize(textWidth + 20, textHeight + 20);
        
        this.setAlpha(1); // Reset alpha to 1 when showing

        // Stop any existing fade-out tweens
        if (this.fadeTween) {
            this.fadeTween.stop();
        }

        this.adjustPosition();

        this.setDepth(1000);
        this.setVisible(true);
    }
  
    hide() {
        if(this.keepVisible) return;
        this.fadeTween = this.scene.tweens.add({
            targets: this,
            alpha: 0,
            duration: 300,
            onComplete: () => {
                this.setVisible(false);
                // this.fadeTween.stop();
            }
        });      
    }

    adjustPosition() {
        const screenWidth = this.scene.sys.game.config.width;
        const halfWidth = this.background.width / 2;
    
        // Check horizontal bounds
        if (this.x - halfWidth < 0) {
          this.setX(halfWidth);
        } else if (this.x + halfWidth > screenWidth) {
          this.setX(screenWidth - halfWidth);
        }
    }
  }
  
  export default Tooltip;