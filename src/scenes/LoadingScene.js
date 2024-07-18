import Phaser from 'phaser';
import http from '../http-common';

class LoadingScene extends Phaser.Scene {
    constructor() {
      super({ key: 'LoadingScene' });
    }
  
    preload() {
      // You can preload assets for the loading screen here
    }
  
    create() {
      // Add some text to indicate loading
      const loadingText = this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2, 'Loading...', { fontSize: '32px', fill: '#ffffff' });
      loadingText.setOrigin(0.5, 0.5);
  
      // Fetch data from the database
      this.fetchDataFromDatabase();
    }
  
    async fetchDataFromDatabase() {      
      http.get('/').then((res) => {
        console.log(res.data);
      });

      let data = {};
      let height = {};
      await http.get('/mempool').then((res) => {
        data = res.data;
      });
      console.log(data);

      await http.get('/latestblock').then((res) => {
        height = res.data;
        // console.log("height", height)

      });
              
      // Pass the fetched data to the MainScene
      this.scene.start('MainScene', { npcData: data, block: height });       
    }
  }
  
  export default LoadingScene;
  