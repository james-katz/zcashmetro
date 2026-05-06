import Phaser from 'phaser';
import http from '../http-common';

/**
 * LoadingScene — preloads assets and fetches initial data.
 */
class LoadingScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LoadingScene' });
  }

  preload() {
    // Station backgrounds (skins)
    // this.load.image('station_bg', './assets/station_bg.png');
    this.load.image('skin_blue', './assets/station_skin_blue.png');
    this.load.image('skin_pink', './assets/station_skin_pink.png');
    this.load.image('skin_green', './assets/station_skin_green.png');

    // Train
    this.load.image('train', './assets/train.png');

    // NPC sprites
    this.load.image('zebra', './assets/zebra.png');
    this.load.image('bronze', './assets/bronze.png');
    this.load.image('silver', './assets/silver.png');
    this.load.image('gold', './assets/gold.png');

    // Progress bar
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const bgBar = this.add.graphics();
    bgBar.fillStyle(0x2a2a32, 1);
    bgBar.fillRect((w - 200) / 2, h / 2 + 30, 200, 8);
    const fillBar = this.add.graphics();
    this.load.on('progress', (v) => {
      fillBar.clear();
      fillBar.fillStyle(0xfebb18, 1);
      fillBar.fillRect((w - 200) / 2, h / 2 + 30, 200 * v, 8);
    });
    this.load.on('complete', () => { fillBar.destroy(); bgBar.destroy(); });
  }

  create() {
    this.add.text(
      this.cameras.main.width / 2, this.cameras.main.height / 2,
      'Loading...', { fontFamily: '"VT323", monospace', fontSize: '32px', fill: '#fff' }
    ).setOrigin(0.5);
    this.fetchInitialData();
  }

  async fetchInitialData() {
    try {
      const [mempoolRes, blockRes] = await Promise.all([
        http.get('/mempool'), http.get('/latestblock'),
      ]);
      this.scene.start('MainScene', { npcData: mempoolRes.data, block: blockRes.data });
    } catch (err) {
      console.error('Failed to fetch initial data:', err);
      this.time.delayedCall(3000, () => this.fetchInitialData());
    }
  }
}

export default LoadingScene;