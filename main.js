import Phaser from 'phaser';
import MainScene from './src/scenes/MainScene';
import LoadingScene from './src/scenes/LoadingScene';
import { initUI } from './src/ui.js';

const container = document.getElementById('game-container');
const navbarHeight = 60;

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: container ? container.clientWidth : window.innerWidth,
  height: window.innerHeight - navbarHeight,
  pixelArt: true,
  scene: [LoadingScene, MainScene],
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
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
  },
};

const game = new Phaser.Game(config);

// Expose game instance for cross-layer access
window.zmGame = game;

// Initialize HTML overlay controller after DOM is ready
initUI();