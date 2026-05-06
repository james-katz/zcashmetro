import Phaser from 'phaser';
import NPC from '../objects/npc';
import Train from '../objects/train';
import http from '../http-common';
import { bfs, bfsClosestDoor } from '../pathfinding';
import zmEvents from '../events';

/**
 * MainScene — uses a single background image as the station.
 *
 * The background image (station_bg.png, 1792×1243) contains everything:
 * skyline, walls, tracks, hazard strip, platform floor.
 *
 * Game resolution: 1792×1243 (Phaser FIT scales to viewport).
 *
 * Layout (approximate Y coordinates in the image):
 *   0–250:   Skyline + walls
 *   250–330: Hazard strip
 *   330–470: Track area (train rides here)
 *   470–560: Gravel/ballast + lower hazard/tactile
 *   560–1243: Platform floor (NPCs walk here)
 */
class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');

    this.npcs = [];
    this.dataLock = false;
    this.blockProcessing = false;
    this.lastTime = 0;
    this.timeInterval = 1000;
    this.blured = false;

    // Image is 1792×1243; game resolution matches 1:1
    this.W = 1792;
    this.H = 1243;

    // Tile unit for grid-based pathfinding (virtual grid over the image)
    this.TILE = 32;
    this.COLS = Math.floor(this.W / this.TILE);  // 56
    this.ROWS = Math.floor(this.H / this.TILE);  // 38

    // Scale factor for NPC sprite sizing (kept for compatibility)
    this.scaleFactor = 2.25;

    // Train placement — centered on the track area
    this.trainY = 590;

    // Train door Y — where NPCs walk to before boarding (top of platform)
    this.doorY = 21; // tile row (21 * 32 = 672px)

    // Door X positions (tile columns, spaced across the train)
    this.doorPositions = [
      { x: 10, y: this.doorY },
      { x: 22, y: this.doorY },
      { x: 34, y: this.doorY },
      { x: 46, y: this.doorY },
    ];

    // Platform walkable bounds (tile coords)
    // Y: from ~row 22 (704px) to row 37 (1184px)
    // X: from col 1 to col 54
    this.platformBounds = { minX: 1, maxX: 54, minY: 23, maxY: 37 };

    // Spawn point (bottom-center of platform)
    this.spawnTile = { x: 28, y: 40 };
  }

  init(data) {
    this.npcData = data.npcData;
    this.currHeight = data.block.height;
  }

  create() {
    // --- Background image (the entire station) ---
    this.bgImage = this.add.image(0, 0, 'skin_blue');
    this.bgImage.setOrigin(0, 0);
    this.bgImage.setDisplaySize(this.W, this.H);
    this.bgImage.setDepth(0);

    // --- Skin switching ---
    zmEvents.on('changeSkin', (skinKey) => {
      if (this.textures.exists(skinKey)) {
        this.bgImage.setTexture(skinKey);
        this.bgImage.setDisplaySize(this.W, this.H);
      }
    });

    // --- Build collision grid ---
    this.buildGrid();

    // --- Train ---
    this.train = new Train(
      this,
      this.W / 2,      // centered horizontally
      this.trainY,      // on the tracks
      'train',
      2.65
    );

    // --- Spawn NPCs ---
    const pb = this.platformBounds;
    for (const tx of this.npcData) {
      const posx = (pb.minX + Math.random() * (pb.maxX - pb.minX)) * this.TILE;
      const posy = (pb.minY + Math.random() * (pb.maxY - pb.minY)) * this.TILE;
      const npc = new NPC(this, tx, posx, posy, this.scaleFactor + 1);
      npc.canWander = true;
      this.npcs.push(npc);
    }

    zmEvents.emit('stats', { height: this.currHeight, mempool: this.npcs.length });

    // --- Visibility handling (tab switch) ---
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.blured = true;
      } else {
        this.blured = false;
        // Force an immediate full resync when the tab regains focus
        // Reset locks that may have gone stale while the tab was hidden
        this.dataLock = false;
        this.blockProcessing = false;
        this.pollServer();
      }
    });

    // Also listen to Phaser's blur/focus as a fallback
    this.game.events.on('blur', () => { this.blured = true; }, this);
    this.game.events.on('focus', () => {
      this.blured = false;
      this.dataLock = false;
      this.blockProcessing = false;
      this.pollServer();
    }, this);
  }

  // ---------------------------------------------------------------------------
  // Code-based collision grid
  // ---------------------------------------------------------------------------

  buildGrid() {
    this.grid = [];
    for (let y = 0; y < this.ROWS; y++) {
      const row = [];
      for (let x = 0; x < this.COLS; x++) {
        let collides = true;

        // Platform floor (walkable)
        if (y >= this.platformBounds.minY && y <= this.platformBounds.maxY &&
          x >= this.platformBounds.minX && x <= this.platformBounds.maxX) {
          collides = false;
        }

        // Door row (walkable at door positions — path to train)
        if (y === this.doorY || y === this.doorY + 1) {
          for (const door of this.doorPositions) {
            if (Math.abs(x - door.x) <= 1) collides = false;
          }
        }

        row.push({ x, y, collides });
      }
      this.grid.push(row);
    }
  }

  worldToTileX(wx) { return Math.floor(wx / this.TILE); }
  worldToTileY(wy) { return Math.floor(wy / this.TILE); }
  tileToWorldX(tx) { return tx * this.TILE; }
  tileToWorldY(ty) { return ty * this.TILE; }

  // ---------------------------------------------------------------------------
  // Update loop
  // ---------------------------------------------------------------------------

  update(time, _delta) {
    if (time - this.lastTime < this.timeInterval) return;
    this.lastTime = time;
    this.updateWandering(time);
    if (!this.dataLock) this.pollServer();
  }

  updateWandering(time) {
    const pb = this.platformBounds;
    for (const npc of this.npcs) {
      if (this.blured || npc.isDestroyed) continue;
      if (Math.random() < 0.2) continue;
      if (!npc.nextMoveAt) npc.nextMoveAt = time + Phaser.Math.Between(2000, 6000);
      if (time < npc.nextMoveAt) continue;
      npc.nextMoveAt = time + Phaser.Math.Between(1500, 7000);

      if (!npc.isPlaying && npc.canWander) {
        const startX = this.worldToTileX(npc.x);
        const startY = this.worldToTileY(npc.y);
        const dx = Phaser.Math.Between(-6, 6);
        const dy = Phaser.Math.Between(-3, 3);
        const px = Phaser.Math.Clamp(startX + dx, pb.minX, pb.maxX);
        const py = Phaser.Math.Clamp(startY + dy, pb.minY, pb.maxY);

        const start = this.grid[startY] && this.grid[startY][startX];
        const goal = this.grid[py] && this.grid[py][px];
        if (!start || !goal) continue;
        npc.moveAlongPath(bfs(start, goal, this.grid), false);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Server polling
  // ---------------------------------------------------------------------------

  async pollServer() {
    this.dataLock = true;
    try {
      const [mempoolRes, blockRes] = await Promise.all([
        http.get('/mempool'), http.get('/latestblock'),
      ]);
      await this.spawnNewTransactions(mempoolRes.data);
      if (blockRes.data.height > this.currHeight) {
        this.currHeight = blockRes.data.height;
        await this.handleNewBlock();
      }
    } catch (err) {
      console.error('Poll error:', err.message);
    } finally {
      this.dataLock = false;
    }
  }

  async spawnNewTransactions(mempool) {
    const pb = this.platformBounds;
    const serverTxids = new Set(mempool.map((tx) => tx.txid));

    // Remove NPCs whose transactions are no longer in the server mempool
    // (they were mined and cleaned up server-side)
    const staleNpcs = [];
    const freshNpcs = [];
    for (const npc of this.npcs) {
      if (npc.isDestroyed) continue;
      if (!serverTxids.has(npc.txid)) {
        staleNpcs.push(npc);
      } else {
        freshNpcs.push(npc);
      }
    }
    for (const npc of staleNpcs) {
      npc.cleanup();
    }
    this.npcs = freshNpcs;

    // Add new transactions not yet represented by NPCs
    for (const tx of mempool) {
      if (this.npcs.some((n) => n.txid === tx.txid)) continue;
      const startTile = this.grid[this.spawnTile.y] && this.grid[this.spawnTile.y][this.spawnTile.x];
      if (!startTile) continue;

      let targetX = pb.minX + Math.floor(Math.random() * (pb.maxX - pb.minX));
      let targetY = pb.minY + Math.floor(Math.random() * (pb.maxY - pb.minY));

      for (let a = 0; a < 10; a++) {
        const cx = pb.minX + Math.floor(Math.random() * (pb.maxX - pb.minX));
        const cy = pb.minY + Math.floor(Math.random() * (pb.maxY - pb.minY));
        if (this.npcs.every((n) => {
          const dx = n.x - cx * this.TILE;
          const dy = n.y - cy * this.TILE;
          return Math.sqrt(dx * dx + dy * dy) >= 48;
        })) { targetX = cx; targetY = cy; break; }
      }

      const goal = this.grid[targetY] && this.grid[targetY][targetX];
      if (!goal) continue;

      const path = bfs(startTile, goal, this.grid);
      const npc = new NPC(
        this, tx,
        this.spawnTile.x * this.TILE,
        this.spawnTile.y * this.TILE,
        this.scaleFactor + 1
      );
      this.npcs.push(npc);

      if (!this.blured) {
        npc.moveAlongPath(path, false);
      } else {
        npc.setX(targetX * this.TILE);
        npc.setY(targetY * this.TILE);
        npc.canWander = true;
      }
    }
    zmEvents.emit('stats', { height: this.currHeight, mempool: this.npcs.length });
  }

  async handleNewBlock() {
    if (this.blockProcessing) return;
    this.blockProcessing = true;

    // Safety timeout: reset blockProcessing after 15s max to prevent stuck state
    const blockTimeout = setTimeout(() => {
      this.blockProcessing = false;
    }, 15000);

    try {
      const minedNpcs = [];
      const keptNpcs = [];
      for (const npc of this.npcs) {
        if (npc.isDestroyed) continue;
        try {
          const r = await http.get(`/txinfo/?txid=${npc.txid}`);
          if (r.data.height > 0) minedNpcs.push(npc);
          else keptNpcs.push(npc);
        } catch { keptNpcs.push(npc); }
      }
      this.npcs = keptNpcs;

      if (minedNpcs.length === 0) {
        this.train.depart();
        zmEvents.emit('stats', { height: this.currHeight, mempool: this.npcs.length });
        return;
      }

      let boarded = 0;
      const total = minedNpcs.length;
      const onBoarded = () => {
        boarded++;
        zmEvents.emit('stats', { height: this.currHeight, mempool: this.npcs.length });
        if (boarded >= total) this.train.depart();
      };

      for (const npc of minedNpcs) {
        npc.canWander = false;
        npc.stopCurrentTween();
        if (this.blured) { npc.cleanup(); onBoarded(); continue; }

        const sx = this.worldToTileX(npc.x);
        const sy = this.worldToTileY(npc.y);
        const start = this.grid[sy] && this.grid[sy][sx];
        if (!start) { npc.cleanup(); onBoarded(); continue; }

        const path = bfsClosestDoor(start, this.doorPositions, this.grid);
        if (!path.length) { npc.cleanup(); onBoarded(); continue; }
        npc.moveAlongPath(path, true, onBoarded);
      }

      zmEvents.emit('stats', { height: this.currHeight, mempool: this.npcs.length });
    } finally {
      clearTimeout(blockTimeout);
      this.blockProcessing = false;
    }
  }
}

export default MainScene;
