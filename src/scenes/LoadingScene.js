import Phaser from 'phaser';
import http from '../http-common';

/**
 * LoadingScene — preloads assets and fetches initial data from the server
 * before transitioning to the main game scene.
 */
class LoadingScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LoadingScene' });
  }

  preload() {
    this.load.image('tileset', './assets/tileset.png');
    this.load.image('train', './assets/train.png');
    this.load.image('zebra', './assets/zebra.png');
    this.load.image('bronze', './assets/bronze.png');
    this.load.image('silver', './assets/silver.png');
    this.load.image('gold', './assets/gold.png');
    this.load.tilemapTiledJSON('map', './assets/station.json');
  }

  create() {
    const loadingText = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2,
      'Loading...',
      { fontSize: '32px', fill: '#ffffff' }
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