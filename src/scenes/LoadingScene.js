import Phaser from 'phaser';
import http from '../http-common';

/**
 * LoadingScene — preloads assets and fetches initial data from the server
 * before transitioning to the main game scene.
 *
 * Uses VT323 font and shows a progress bar per the design guide.
 */
class LoadingScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LoadingScene' });
  }

  preload() {
    // Tileset and tilemap
    this.load.image('tileset', './assets/tileset.png');
    this.load.tilemapTiledJSON('map', './assets/station.json');

    // Skyline background
    this.load.image('skyline', './assets/skyline.png');

    // Train
    this.load.image('train', './assets/train.png');

    // NPC sprites
    this.load.image('zebra', './assets/zebra.png');
    this.load.image('bronze', './assets/bronze.png');
    this.load.image('silver', './assets/silver.png');
    this.load.image('gold', './assets/gold.png');

    // --- Progress bar ---
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    const barWidth = 200;
    const barHeight = 8;
    const barX = (width - barWidth) / 2;
    const barY = height / 2 + 30;

    // Background bar
    const bgBar = this.add.graphics();
    bgBar.fillStyle(0x2a2a32, 1);
    bgBar.fillRect(barX, barY, barWidth, barHeight);

    // Fill bar
    const fillBar = this.add.graphics();
    this.load.on('progress', (value) => {
      fillBar.clear();
      fillBar.fillStyle(0xfebb18, 1);
      fillBar.fillRect(barX, barY, barWidth * value, barHeight);
    });

    this.load.on('complete', () => {
      fillBar.destroy();
      bgBar.destroy();
    });
  }

  create() {
    const loadingText = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2,
      'Loading...',
      {
        fontFamily: '"VT323", "Press Start 2P", monospace',
        fontSize: '32px',
        fill: '#ffffff',
      }
    );
    loadingText.setOrigin(0.5, 0.5);

    this.fetchInitialData();
  }

  /**
   * Fetch mempool and latest block data, then start MainScene.
   */
  async fetchInitialData() {
    try {
      const [mempoolRes, blockRes] = await Promise.all([
        http.get('/mempool'),
        http.get('/latestblock'),
      ]);

      this.scene.start('MainScene', {
        npcData: mempoolRes.data,
        block: blockRes.data,
      });
    } catch (err) {
      console.error('Failed to fetch initial data:', err);

      // Retry after a delay
      this.time.delayedCall(3000, () => {
        this.fetchInitialData();
      });
    }
  }
}

export default LoadingScene;