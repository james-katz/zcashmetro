import Phaser from 'phaser';
import NPC from '../objects/npc';
import Train from '../objects/train'
import Sign from '../objects/sign'
import http from '../http-common';

class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');

    this.npcs = [];
    this.dataLock;
    this.lastTime = 0;
    this.timeInterval = 3000;    
    this.bgInterval; 
  }

  init(data) {
    this.npcData = data.npcData; // Receive the data from LoadingScene
    this.currHeight = data.block.height;
    // console.log(data.block)
  }

  preload() {
    // Load assets here
      this.load.image('tileset', './assets/tileset.png');
      this.load.image('train', './assets/train.png')
      this.load.image('zebra', './assets/zebra.png');
      this.load.tilemapTiledJSON('map', './assets/station.json');      
  }

  create() {
    // Initialize your scene here  
    const canvasWidth = this.game.config.width;
    const canvasHeight = this.game.config.height;
    const tileWidth = 12;
    const mapWidth = 45;
    const mapHeight = 62;
    const mapWidthInPixels = mapWidth * tileWidth;
    const mapHeightInPixels = mapHeight * tileWidth;

    // Calculate scale factor to fit the map to the canvas width
    this.scaleFactor = canvasWidth / mapWidthInPixels;
    // this.scaleFactor = canvasHeight / mapHeightInPixels;
    this.map = this.make.tilemap({ key: 'map' });
    const tileset = this.map.addTilesetImage('subway', 'tileset');
    const layer = this.map.createLayer(0, tileset);
    
    layer.setScale(this.scaleFactor);
    layer.setCollisionByProperty({collides: true});

    // Center the canvas in the window    
    // this.scale.displaySize.setAspectRatio(canvasWidth / canvasHeight);
    // this.scale.resize(mapWidthInPixels*this.scaleFactor, mapHeightInPixels*this.scaleFactor);
    // this.scale.refresh();
  
    // Set world boundaries
    this.physics.world.setBounds(0, 0, this.scale.width, this.scale.height, true, true , true, true);    

    // Train initialization stuff
    this.train = new Train(this, 22 * this.map.tileWidth * this.scaleFactor, 10 * this.map.tileHeight * this.scaleFactor, 'train', this.scaleFactor);    
    this.physics.add.collider(this.train, layer);
    
    // Create a grid representation from the tilemap layer
    this.grid = [];
    for (let y = 0; y < this.map.height; y++) {
      const row = [];
      for (let x = 0; x < this.map.width; x++) {
        const tile = layer.getTileAt(x, y);
        row.push({ x, y, collides: tile ? tile.collides : false });
      }
      this.grid.push(row);
    }    

    // Visualize the collision boxes for debugging
  //   const debugGraphics = this.add.graphics().setAlpha(0.75);
  //   layer.renderDebug(debugGraphics, {
  //     tileColor: null, // Non-colliding tiles
  //     collidingTileColor: new Phaser.Display.Color(243, 134, 48, 255), // Colliding tiles
  //   });

  //   this.input.on('pointermove', pointer => {
  //     const worldPoint = pointer.positionToCamera(this.cameras.main);
  //     const tileX = this.map.worldToTileX(worldPoint.x);
  //     const tileY = this.map.worldToTileY(worldPoint.y);
    
  //     debugText.setText(`Tile X: ${tileX}, Tile Y: ${tileY}`);
  // });
    
  // const debugText = this.add.text(16, 16, '', {
  //   fontSize: '58px',
  //   fill: '#ffffff'
  // });
    
    // Create all tx NPCs received from init
    for(const tx of this.npcData) {
      // console.log(tx)
      let posx = (2+Math.random()*41) * this.map.tileWidth * this.scaleFactor;
      let posy = (19 + Math.random()*8) * this.map.tileHeight * this.scaleFactor;
      const npc = new NPC(this, tx.txid, posx, posy, 'zebra', this.scaleFactor);
      this.npcs.push(npc);
      this.physics.add.collider(this.npcs, layer);
    }

    // Add sign info
    this.heightSign = new Sign(this, 7 * this.map.tileWidth * this.scaleFactor, 3 * this.map.tileWidth * this.scaleFactor, `Current block\n${this.currHeight}`, this.scaleFactor)
    this.mempoolSign = new Sign(this, 38 * this.map.tileWidth * this.scaleFactor, 3 * this.map.tileWidth * this.scaleFactor, `In mempool\n${this.npcs.length}`, this.scaleFactor)
    
    this.enableCameraScrolling();

    // When tabs are switched, restart the scene to avois weird behaviour
    this.game.events.on('blur', () => {      
      this.blured = true;
      // if(this.bgInterval) {
      //   console.log("bg interval already running")
      //   return;
      // }
      // console.log("Starting bg interval stuff");
      // this.bgInterval = setInterval(() => {
      //   this.npcs.forEach(async (npc) => {  
      //     const res = await http.get(`/txinfo/?txid=${npc.txid}`);
    
      //     if(res.data.height > 0) {
      //       npc.tooltip.destroy();
      //       npc.destroy();
      //       this.npcs.splice(this.npcs.indexOf(npc), 1);
      //     }
      //   });
      // }, 1000);
    }, this);
        
    this.game.events.on('focus', () => {
      if(this.blured) {
        console.log("When focus is back to this tab, remove previous mined txns ...")        
        this.npcs.forEach(async (npc) => {  
          const res = await http.get(`/txinfo/?txid=${npc.txid}`);
  
         if(res.data.height > 0) {
            const npc_tweens = this.tweens.getTweensOf(npc);
            if(npc_tweens[0]) npc_tweens[0].destroy();
            npc.tooltip.destroy();
            npc.destroy();
            this.npcs.splice(this.npcs.indexOf(npc), 1);
          }
        });
        // clearInterval(this.bgInterval);
        // this.bgInterval = undefined;
        this.blured = false;
      }
    }, this);
  }

  async update(time, delta) {
    // Update your scene here
    if(time - this.lastTime >= this.timeInterval) {
      this.lastTime = time;
      if(this.dataLock) {
        console.log("Already processing ...")
        return; 
      }
      
      this.dataLock = true;

      let mempool;

      await http.get('/mempool').then((res) => {
        mempool = res.data
        mempool.forEach(tx => {
          if(this.npcs.filter((npc) => npc.txid == tx.txid).length == 0) {
            // console.log(tx.txid);

            const spawnx = 22;
            const spawny = 62;      
            const start = this.grid[spawny][spawnx];
            let posx = parseInt(Math.random()*44);
            let posy = parseInt(Math.random()*6) + 20;
            const goal = this.grid[posy][posx];
            const path = bfs(start, goal, this.grid);
            
            // Add NPCs in a timeout, to avoid creating each new npc at once.
            // setTimeout(() => {
              const npc = new NPC(this, tx.txid, this.map.tileToWorldX(spawnx), this.map.tileToWorldY(spawny), 'zebra', this.scaleFactor);            
              this.npcs.push(npc);
              // this.physics.add.collider(this.npcs, layer);
              npc.moveAlongPath(path, false);              
            // },300);
          }
        });        

        this.mempoolSign.updateText(`In mempool\n${this.npcs.length}`)

      });        

      await http.get('/latestblock').then(async (res) => {
        if(res.data.height > this.currHeight) {
          this.currHeight = res.data.height;
          console.log(this.currHeight)
          this.heightSign.updateText(`Current height\n${this.currHeight}`);
          
          // Keep any unmied tx and send the rest to the train
          // mempool = await http.get('/mempool');
          
          this.npcs.forEach(async (npc) => {  
            const res = await http.get(`/txinfo/?txid=${npc.txid}`);
      
            if(res.data.height > 0) {
              const npc_tweens = this.tweens.getTweensOf(npc);
              if(npc_tweens[0]) npc_tweens[0].destroy();
      
              const startX = this.map.worldToTileX(npc.x);
              const startY = this.map.worldToTileY(npc.y);
              const start = this.grid[startY][startX];
      
              let posx = 6;
              let posy = 11;
      
              if(startX > 12 && start <= 21) posx = 18;
              else if(startX > 21 && startX <= 30) posx = 25;
              else if(startX > 30) posx = 37;
      
              const goal = this.grid[posy][posx];
              const path_to_train = bfs(start, goal, this.grid);
              npc.moveAlongPath(path_to_train, true);
      
              this.npcs.splice(this.npcs.indexOf(npc), 1);
            }
            else {
              console.log(`Keeping ${npc.txid}`);
            }           
          });
          
          this.time.delayedCall(1500, () => {this.train.depart()});
        }

        this.dataLock = false;
      });
    }
  }

  enableCameraScrolling() {
    // Mouse wheel scrolling
    this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY, deltaZ) => {
      // this.cameras.main.scrollY += deltaY * 0.1;
      this.scrollCamera(deltaY * 0.8);
    });
  
     // Touch scrolling
     let touchStartY = 0;
     this.input.on('pointerdown', pointer => {
       if (pointer.isDown) {
         touchStartY = pointer.y;
       }
     });

     this.input.on('pointermove', pointer => {
      // console.log(pointer)
      if (pointer.isDown) {
        const deltaY = pointer.y - touchStartY;
        // this.cameras.main.scrollY -= deltaY * 0.4;

        this.scrollCamera(deltaY * -0.8);
        touchStartY = pointer.y;
      }
    });

    // Add event listener for window focus
    window.addEventListener('focus', () => {
      this.input.mousePointer.isDown = false;
    });

    document.addEventListener('wheel', event => {
      const delta = event.deltaY;
      this.scrollCamera(delta * 0.8);
    });
  }

  scrollCamera(deltaY) {
    // Calculate new scrollY value
    const newScrollY = Phaser.Math.Clamp(
      this.cameras.main.scrollY + deltaY,
      0,
      this.map.heightInPixels * this.scaleFactor - this.game.config.height
    );
    this.cameras.main.scrollY = newScrollY;
    // console.log(newScrollY)
  }

}

export default MainScene;

function bfs(start, goal, grid) {
  const queue = [];
  const cameFrom = new Map();
  queue.push(start);
  cameFrom.set(start, null);

  while (queue.length > 0) {
    const current = queue.shift();
    
    if (current === goal) {
      const path = [];
      let temp = current;
      while (temp) {
        path.push(temp);
        temp = cameFrom.get(temp);
      }
      return path.reverse();
    }

    const neighbors = getNeighbors(current, grid, cameFrom);
    for (const neighbor of neighbors) {
      if (!cameFrom.has(neighbor)) {        
        queue.push(neighbor);                
        cameFrom.set(neighbor, current);
      }
    }
  
  }

  return [];
}

function getNeighbors(node, grid) {
  const neighbors = [];
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [-1, -1], [1, 1]];

  for (const [dx, dy] of dirs) {
    const x = node.x + dx;
    const y = node.y + dy;

    if (grid[y] && grid[y][x] && grid[y][x].collides !== true) {
      neighbors.push(grid[y][x]);      
    }
  }

  return neighbors;
}
