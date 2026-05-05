import Phaser from 'phaser';
import MainScene from './src/scenes/MainScene';
import LoadingScene from './src/scenes/LoadingScene';
import { initUI } from './src/ui.js';

// Fixed game resolution — matches station_bg.png (1792×1243)
// Phaser FIT scales to viewport, maintaining aspect ratio with black bars
const GAME_WIDTH = 1792;
const GAME_HEIGHT = 1243;

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  pixelArt: true,
  scene: [LoadingScene, MainScene],
  backgroundColor: '#0e0f18',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false,
    },
  },
  fps: {
    target: 60,
    forceSetTimeOut: true,
    deltaHistory: 10,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

const game = new Phaser.Game(config);

// Expose game instance for cross-layer access
window.zmGame = game;

// Initialize HTML overlay controller after DOM is ready
initUI();