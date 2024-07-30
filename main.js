import Phaser from 'phaser';
import MainScene from './src/scenes/MainScene';
import LoadingScene from './src/scenes/LoadingScene';

const config = {
  type: Phaser.AUTO,
  width: window.innerWidth * 0.70,
  height: window.innerHeight,
  pixelArt: true,
  scene: [LoadingScene, MainScene],
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
  },
  fps: {
    target: 60, // Desired framerate
    forceSetTimeOut: true, // Ensures the game loop continues to run in background
    deltaHistory: 10, // For better accuracy
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
};

const game = new Phaser.Game(config);