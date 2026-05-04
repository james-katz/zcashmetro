import Phaser from 'phaser';
import NPC from '../objects/npc';
import Train from '../objects/train';
import http from '../http-common';
import { bfs, bfsClosestDoor } from '../pathfinding';
import zmEvents from '../events';

/**
 * MainScene — the train station where zebras (transactions) wander
 * on the platform and board the train (block) when mined.
 *
 * Visual layers (by depth):
 *   0  — Skyline background image
 *   5  — Tilemap (station platform, tunnel, tracks)
 *  10  — Train sprite (in the tunnel area)
 *  22  — NPCs (zebras on the platform)
 */
class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');

    /** @type {NPC[]} Active NPC sprites representing mempool transactions. */
    this.npcs = [];

    /** @type {boolean} Prevents overlapping data fetches. */
    this.dataLock = false;

    /** @type {boolean} Prevents overlapping block-processing passes. */
    this.blockProcessing = false;

    /** @type {number} Timestamp of the last update cycle. */
    this.lastTime = 0;

    /** @type {number} Milliseconds between update cycles. */
    this.timeInterval = 1000;

    /** @type {boolean} Whether the browser tab is hidden. */
    this.blured = false;

    /**
     * The 4 train door tile positions.
     * NPCs walk to the closest door when boarding.
     * @type {{ x: number, y: number }[]}
     */
    this.doorPositions = [
      { x: 8, y: 21 },
      { x: 18, y: 21 },
      { x: 27, y: 21 },
      { x: 36, y: 21 },
    ];

    /**
     * Walkable platform bounds (tile coordinates).
     * NPCs wander within these bounds.
     */
    this.platformBounds = {
      minX: 1,
      maxX: 43,
      minY: 23,
      maxY: 33,
    };

    /** Spawn point for new NPCs (bottom-center escalator area) */
    this.spawnTile = { x: 22, y: 33 };
  }

  init(data) {
    this.npcData = data.npcData;
    this.currHeight = data.block.height;
  }

  create() {
    const canvasWidth = this.game.config.width;
    const tileWidth = 12;
    const mapWidth = 45;

    this.blured = false;

    // Scale the tilemap to fit the canvas
    const mapWidthInPixels = mapWidth * tileWidth;
    this.scaleFactor = canvasWidth / mapWidthInPixels;

    // --- Layer 0: Skyline background ---
    this.createSkyline();

    // --- Layer 5: Tilemap ---
    this.map = this.make.tilemap({ key: 'map' });
    const tileset = this.map.addTilesetImage('subway', 'tileset');
    const layer = this.map.createLayer(0, tileset);

    layer.setScale(this.scaleFactor);
    layer.setCollisionByProperty({ collides: true });
    layer.setDepth(5);

    this.physics.world.setBounds(
      0, 0,
      this.scale.width, this.scale.height,
      true, true, true, true
    );

    // --- Layer 10: Train ---
    this.train = new Train(
      this,
      22 * this.map.tileWidth * this.scaleFactor,
      16 * this.map.tileHeight * this.scaleFactor,
      'train',
      this.scaleFactor
    );
    this.physics.add.collider(this.train, layer);

    // --- Build navigation grid from tilemap ---
    this.grid = [];
    for (let y = 0; y < this.map.height; y++) {
      const row = [];
      for (let x = 0; x < this.map.width; x++) {
        const tile = layer.getTileAt(x, y);
        row.push({ x, y, collides: tile ? tile.collides : false });
      }
      this.grid.push(row);
    }

    // --- Spawn initial mempool NPCs ---
    for (const tx of this.npcData) {
      const pb = this.platformBounds;
      const posx = (pb.minX + Math.random() * (pb.maxX - pb.minX)) * this.map.tileWidth * this.scaleFactor;
      const posy = (pb.minY + Math.random() * (pb.maxY - pb.minY)) * this.map.tileHeight * this.scaleFactor;
      const npc = new NPC(this, tx, posx, posy, this.scaleFactor);
      npc.canWander = true;
      this.npcs.push(npc);
    }

    // Send initial stats to HTML navbar
    zmEvents.emit('stats', {
      height: this.currHeight,
      mempool: this.npcs.length,
    });

    this.enableCameraScrolling();

    // Track tab visibility
    this.game.events.on('blur', () => {
      this.blured = true;
    }, this);

    this.game.events.on('focus', () => {
      this.blured = false;
    }, this);
  }

  // ---------------------------------------------------------------------------
  // Skyline background
  // ---------------------------------------------------------------------------

  /**
   * Render the AI-generated skyline as a background image at depth 0.
   */
  createSkyline() {
    const skyline = this.add.image(0, 0, 'skyline');
    skyline.setOrigin(0, 0);
    skyline.setDepth(0);

    // Scale to fill the entire canvas as a backdrop
    const canvasWidth = this.game.config.width;
    const canvasHeight = this.game.config.height;
    const scaleX = canvasWidth / skyline.width;
    const scaleY = canvasHeight / skyline.height;
    const scale = Math.max(scaleX, scaleY);
    skyline.setScale(scale);

    // Shift upward so we see the building midsections, not rooftops.
    // The skyline peeks through transparent tile areas (station "windows").
    const yOffset = -(skyline.height * scale - canvasHeight) * 0.4;
    skyline.setY(yOffset);

    // Add twinkling star overlay across the skyline area
    this.createStars(canvasWidth, canvasHeight * 0.4);
  }

  /**
   * Create subtle twinkling star points in the skyline area.
   */
  createStars(width, height) {
    const starCount = 20;
    for (let i = 0; i < starCount; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height * 0.4; // upper portion only
      const size = Math.random() < 0.3 ? 2 : 1;
      const color = Math.random() < 0.2 ? 0xfde47a : 0xffffff;

      const star = this.add.circle(x, y, size, color, 0.8);
      star.setDepth(1);

      // Twinkle animation
      this.tweens.add({
        targets: star,
        alpha: { from: 0.3, to: 1 },
        duration: 1500 + Math.random() * 2000,
        yoyo: true,
        repeat: -1,
        delay: Math.random() * 3000,
        ease: 'Stepped',
        easeParams: [2],
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Main update loop
  // ---------------------------------------------------------------------------

  update(time, _delta) {
    if (time - this.lastTime < this.timeInterval) return;
    this.lastTime = time;

    // Animate idle NPCs with staggered wandering
    this.updateWandering(time);

    // Poll server for new transactions and block changes
    if (!this.dataLock) {
      this.pollServer();
    }
  }

  // ---------------------------------------------------------------------------
  // Wandering logic
  // ---------------------------------------------------------------------------

  /**
   * Make idle NPCs wander to random nearby tiles.
   * @param {number} time  Current game time in ms
   */
  updateWandering(time) {
    const pb = this.platformBounds;
    for (const npc of this.npcs) {
      if (this.blured) break;
      if (npc.isDestroyed) continue;
      if (Math.random() < 0.2) continue;

      // Stagger movement: each NPC has its own next-move timer
      if (!npc.nextMoveAt) npc.nextMoveAt = time + Phaser.Math.Between(2000, 6000);
      if (time < npc.nextMoveAt) continue;
      npc.nextMoveAt = time + Phaser.Math.Between(1500, 7000);

      if (!npc.isPlaying && npc.canWander) {
        const startX = this.map.worldToTileX(npc.x);
        const startY = this.map.worldToTileY(npc.y);

        const dx = Phaser.Math.Between(-6, 6);
        const dy = Phaser.Math.Between(-3, 3);

        const posx = Phaser.Math.Clamp(startX + dx, pb.minX, pb.maxX);
        const posy = Phaser.Math.Clamp(startY + dy, pb.minY, pb.maxY);

        const start = this.grid[startY] && this.grid[startY][startX];
        const goal = this.grid[posy] && this.grid[posy][posx];
        if (!start || !goal) continue;

        const path = bfs(start, goal, this.grid);
        npc.moveAlongPath(path, false);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Server polling
  // ---------------------------------------------------------------------------

  /**
   * Poll the server for mempool updates and new blocks.
   * Uses dataLock to prevent concurrent requests.
   */
  async pollServer() {
    this.dataLock = true;

    try {
      // Fetch mempool and latest block in parallel
      const [mempoolRes, blockRes] = await Promise.all([
        http.get('/mempool'),
        http.get('/latestblock'),
      ]);

      const mempool = mempoolRes.data;
      const latestHeight = blockRes.data.height;

      // Spawn new transactions that aren't already represented
      await this.spawnNewTransactions(mempool);

      // If a new block was mined, handle boarding + departure
      if (latestHeight > this.currHeight) {
        this.currHeight = latestHeight;
        await this.handleNewBlock();
      }
    } catch (err) {
      console.error('Poll error:', err.message);
    } finally {
      this.dataLock = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Spawning new transactions
  // ---------------------------------------------------------------------------

  /**
   * Spawn NPC zebras for new transactions that appeared in the mempool.
   * @param {{ txid: string, type: string }[]} mempool  Current mempool from server
   */
  async spawnNewTransactions(mempool) {
    const pb = this.platformBounds;

    for (const tx of mempool) {
      // Skip if we already have this NPC
      if (this.npcs.some((npc) => npc.txid === tx.txid)) continue;

      const startTile = this.grid[this.spawnTile.y] && this.grid[this.spawnTile.y][this.spawnTile.x];
      if (!startTile) continue;

      // Find a non-overlapping target tile on the platform
      let targetX = Math.floor(pb.minX + Math.random() * (pb.maxX - pb.minX));
      let targetY = Math.floor(pb.minY + Math.random() * (pb.maxY - pb.minY));

      for (let attempt = 0; attempt < 10; attempt++) {
        const candidateX = Math.floor(pb.minX + Math.random() * (pb.maxX - pb.minX));
        const candidateY = Math.floor(pb.minY + Math.random() * (pb.maxY - pb.minY));

        const ok = this.npcs.every((n) => {
          const dxPx = n.x - this.map.tileToWorldX(candidateX);
          const dyPx = n.y - this.map.tileToWorldY(candidateY);
          return Math.sqrt(dxPx * dxPx + dyPx * dyPx) >= 32;
        });

        if (ok) {
          targetX = candidateX;
          targetY = candidateY;
          break;
        }
      }

      const goal = this.grid[targetY] && this.grid[targetY][targetX];
      if (!goal) continue;

      // Double-check the tx is actually still in the mempool (not yet mined)
      try {
        const txInfoRes = await http.get(`/txinfo/?txid=${tx.txid}`);
        if (txInfoRes.data.height >= 0 && !txInfoRes.data.error) {
          continue;
        }
      } catch {
        continue;
      }

      const path = bfs(startTile, goal, this.grid);

      const npc = new NPC(
        this,
        tx,
        this.map.tileToWorldX(this.spawnTile.x),
        this.map.tileToWorldY(this.spawnTile.y),
        this.scaleFactor
      );
      this.npcs.push(npc);

      if (!this.blured) {
        npc.moveAlongPath(path, false);
      } else {
        npc.setX(targetX * 12 * this.scaleFactor);
        npc.setY(targetY * 12 * this.scaleFactor);
        npc.canWander = true;
      }
    }

    // Update navbar stats
    zmEvents.emit('stats', {
      height: this.currHeight,
      mempool: this.npcs.length,
    });
  }

  // ---------------------------------------------------------------------------
  // Block handling — the core boarding + departure sequence
  // ---------------------------------------------------------------------------

  /**
   * Handle a newly mined block:
   * 1. Query each NPC to see if its tx was mined
   * 2. Animate mined NPCs walking to the nearest train door
   * 3. Wait for ALL boarding animations to complete
   * 4. Only THEN depart the train
   */
  async handleNewBlock() {
    if (this.blockProcessing) return;
    this.blockProcessing = true;

    // Identify which NPCs were mined in this block
    const minedNpcs = [];
    const keptNpcs = [];

    for (const npc of this.npcs) {
      if (npc.isDestroyed) continue;

      try {
        const res = await http.get(`/txinfo/?txid=${npc.txid}`);
        if (res.data.height > 0) {
          minedNpcs.push(npc);
        } else {
          keptNpcs.push(npc);
        }
      } catch {
        keptNpcs.push(npc);
      }
    }

    // Update the NPC list to only contain unmined transactions
    this.npcs = keptNpcs;

    if (minedNpcs.length === 0) {
      console.log('Train leaving with no passengers!');
      this.train.depart();
      zmEvents.emit('stats', { height: this.currHeight, mempool: this.npcs.length });
      this.blockProcessing = false;
      return;
    }

    // --- Boarding sequence ---
    let boardedCount = 0;
    const totalBoarding = minedNpcs.length;

    const onNpcBoarded = () => {
      boardedCount++;
      zmEvents.emit('stats', { height: this.currHeight, mempool: this.npcs.length });

      if (boardedCount >= totalBoarding) {
        console.log(`All ${totalBoarding} passengers boarded. Departing!`);
        this.train.depart();
      }
    };

    for (const npc of minedNpcs) {
      npc.canWander = false;
      npc.stopCurrentTween();

      if (this.blured) {
        npc.cleanup();
        onNpcBoarded();
        continue;
      }

      // Find path to the closest train door
      const startX = this.map.worldToTileX(npc.x);
      const startY = this.map.worldToTileY(npc.y);
      const start = this.grid[startY] && this.grid[startY][startX];

      if (!start) {
        npc.cleanup();
        onNpcBoarded();
        continue;
      }

      const pathToTrain = bfsClosestDoor(start, this.doorPositions, this.grid);

      if (pathToTrain.length === 0) {
        npc.cleanup();
        onNpcBoarded();
        continue;
      }

      npc.moveAlongPath(pathToTrain, true, () => {
        onNpcBoarded();
      });
    }

    zmEvents.emit('stats', { height: this.currHeight, mempool: this.npcs.length });
    this.blockProcessing = false;
  }

  // ---------------------------------------------------------------------------
  // Camera scrolling
  // ---------------------------------------------------------------------------

  enableCameraScrolling() {
    // Mouse wheel
    this.input.on('wheel', (_pointer, _gameObjects, _deltaX, deltaY) => {
      this.scrollCamera(deltaY * 0.8);
    });

    // Touch drag
    let touchStartY = 0;
    this.input.on('pointerdown', (pointer) => {
      if (pointer.isDown) {
        touchStartY = pointer.y;
      }
    });

    this.input.on('pointermove', (pointer) => {
      if (pointer.isDown) {
        const deltaY = pointer.y - touchStartY;
        this.scrollCamera(deltaY * -0.8);
        touchStartY = pointer.y;
      }
    });

    window.addEventListener('focus', () => {
      this.input.mousePointer.isDown = false;
    });

    document.addEventListener('wheel', (event) => {
      this.scrollCamera(event.deltaY * 0.8);
    });
  }

  /**
   * Scroll the camera vertically, clamped to the map bounds.
   * @param {number} deltaY  Scroll amount in pixels
   */
  scrollCamera(deltaY) {
    const newScrollY = Phaser.Math.Clamp(
      this.cameras.main.scrollY + deltaY,
      0,
      this.map.heightInPixels * this.scaleFactor - this.game.config.height
    );
    this.cameras.main.scrollY = newScrollY;
  }
}

export default MainScene;
