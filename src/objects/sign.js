class Sign extends Phaser.GameObjects.Container {
    constructor(scene, x, y, text, scl) {
      super(scene, x, y);
  
      // Create the background rectangle
      this.background = scene.add.rectangle(0, 0, 128*scl, 60*scl, 0x000000, 0.85);
      this.background.setOrigin(0.5, 0.5); // Center the rectangle
  
      // Create the text
      this.text = scene.add.text(0, 0, text, {
        fontSize: `${14*scl}px`,
        fill: '#ffffff',
        align: 'center',
        wordWrap: { width: 320, useAdvancedWrap: true }
      });
      this.text.setOrigin(0.5, 0.5); // Center the text
      
    // Add background and text to the container
    this.add([this.background, this.text]);      
    
      // Add this container to the scene
      scene.add.existing(this);
    }
  
    updateText(newText) {
      this.text.setText(newText);
      this.text.setOrigin(0.5, 0.5); // Center the text
    }
  }
  
  export default Sign;