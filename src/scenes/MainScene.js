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
    this.pollSeq = 0;
    this.pollStartedAt = 0;
    this.lastTime = 0;
    this.timeInterval = 1000;
    this.blured = false;

    // Server epoch — changes when the server restarted with a fresh mempool
    this.epoch = undefined;
    this.epochGraceUntil = 0;

    // Track recently-mined txids to prevent ghost re-spawns
    this.recentlyMined = new Set();

    // Block timestamp (Unix epoch) from server for elapsed display
    this.blockTime = null;

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
      { x: 7.7, y: this.doorY },
      { x: 23.5, y: this.doorY },
      { x: 32.4, y: this.doorY },
      { x: 48.4, y: this.doorY },
    ];

    // Platform walkable bounds (tile coords)
    // Y: from ~row 22 (704px) to row 37 (1184px)
    // X: from col 1 to col 54
    this.platformBounds = { minX: 1, maxX: 54, minY: 23, maxY: 37 };

    // Spawn point (bottom-center of platform)
    this.spawnTile = { x: 28, y: 38 };
  }

  init(data) {
    this.npcData = data.npcData;
    this.currHeight = data.block.height;
    if (data.block.blockTime) {
      this.blockTime = data.block.blockTime;
    }
    this.epoch = data.block.epoch;
  }

  create() {
    // --- Background image (the entire station) ---
    this.bgImage = this.add.image(0, 0, 'skin_blue');
    this.bgImage.setOrigin(0, 0);
    this.bgImage.setDisplaySize(this.W, this.H);
    this.bgImage.setDepth(0);

    // Debug, do not uncomment:
    // for (const d of this.doorPositions) {
    //   let a = this.add.rectangle(this.tileToWorldX(d.x), this.tileToWorldY(d.y), 32 * this.scaleFactor, 32 * this.scaleFactor, 0x00ff00);
    //   a.setDepth(200);
    // }

    // --- Skin switching ---
    zmEvents.on('changeSkin', (skinKey) => {
      const train_skin = `train_${skinKey}`;
      if (this.textures.exists(skinKey) && this.textures.exists(train_skin)) {
        this.bgImage.setTexture(skinKey);
        this.bgImage.setDisplaySize(this.W, this.H);
        this.train.setTexture(train_skin);
      }
    });

    // --- Build collision grid ---
    this.buildGrid();

    // --- Train ---
    this.train = new Train(
      this,
      this.W / 2,      // centered horizontally
      this.trainY,      // on the tracks
      'train_skin_blue',
      2.95
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

    zmEvents.emit('stats', { height: this.currHeight, mempool: this.npcs.length, blockTime: this.blockTime });

    // --- Visibility handling (tab switch) ---
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.blured = true;
      } else {
        this.blured = false;
        // Force an immediate full resync when the tab regains focus.
        // pollServer() supersedes any in-flight poll (sequence number).
        this.pollServer();
      }
    });

    // Also listen to Phaser's blur/focus as a fallback
    this.game.events.on('blur', () => { this.blured = true; }, this);
    this.game.events.on('focus', () => {
      this.blured = false;
      this.pollServer();
    }, this);
  }

  // ---------------------------------------------------------------------------
  // Code-based collision grid
  // ---------------------------------------------------------------------------

  buildGrid() {
    this.grid = [];

    // Extend grid rows to include the off-screen spawn point
    const gridRows = Math.max(this.ROWS, this.spawnTile.y + 1);

    for (let y = 0; y < gridRows; y++) {
      const row = [];
      for (let x = 0; x < this.COLS; x++) {
        let collides = true;

        // Platform floor (walkable)
        if (y >= this.platformBounds.minY && y <= this.platformBounds.maxY &&
          x >= this.platformBounds.minX && x <= this.platformBounds.maxX) {
          collides = false;
        }

        // Spawn corridor: rows below platform to spawn point (walkable)
        // so BFS can find a path from spawn → platform
        if (y > this.platformBounds.maxY && y <= this.spawnTile.y &&
          x >= this.platformBounds.minX && x <= this.platformBounds.maxX) {
          collides = false;
        }

        // Door row (walkable at door positions — path to train)
        if (y === this.doorY || y === this.doorY + 1) {
          for (const door of this.doorPositions) {
            if (Math.abs(x - door.x) <= 1.5) collides = false;
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
    // Safety net: never let a poll lock stay held forever.
    if (this.dataLock && Date.now() - this.pollStartedAt > 15000) {
      console.warn('Poll lock held too long — releasing');
      this.dataLock = false;
    }
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

  /**
   * Fetch an atomic snapshot of the station state from the server.
   * Falls back to the legacy endpoints if the server has no /state.
   * @returns {Promise<{ height: number, blockTime: number|null, epoch?: number, mempool: {txid: string, type: string}[], mined: {txid: string, height: number}[]|null }>}
   */
  async fetchState() {
    try {
      const { data } = await http.get('/state');
      return data;
    } catch (err) {
      if (!(err.response && err.response.status === 404)) throw err;
      const [mempoolRes, blockRes] = await Promise.all([
        http.get('/mempool'), http.get('/latestblock'),
      ]);
      return {
        height: blockRes.data.height,
        blockTime: blockRes.data.blockTime,
        mempool: mempoolRes.data,
        mined: null, // unknown: treat disappeared txs as mined on a new block
      };
    }
  }

  async pollServer() {
    const seq = ++this.pollSeq;
    this.dataLock = true;
    this.pollStartedAt = Date.now();
    try {
      const state = await this.fetchState();
      // A newer poll was started meanwhile (e.g. tab refocus) — drop this one.
      if (seq !== this.pollSeq) return;
      if (!state || !Array.isArray(state.mempool) || !(state.height > 0)) return;

      // Capture block timestamp for elapsed display
      if (state.blockTime) {
        this.blockTime = state.blockTime;
      }

      // Server restarted with a fresh mempool: give it a moment to refill
      // before removing zebras that are temporarily missing.
      if (state.epoch !== undefined && state.epoch !== this.epoch) {
        if (this.epoch !== undefined) {
          console.warn(`Server epoch changed ${this.epoch} → ${state.epoch}; resyncing`);
          this.epochGraceUntil = Date.now() + 8000;
        }
        this.epoch = state.epoch;
      }

      const minedMap = state.mined
        ? new Map(state.mined.map((m) => [m.txid, m.height]))
        : null;

      // Handle new block FIRST — mined NPCs board before new ones spawn.
      // This prevents mined txs from being re-spawned as ghost NPCs.
      const newBlock = state.height > this.currHeight;
      if (newBlock) this.currHeight = state.height;

      this.syncNpcs(state.mempool, minedMap, newBlock);
    } catch (err) {
      console.error('Poll error:', err.message);
    } finally {
      if (seq === this.pollSeq) this.dataLock = false;
    }
  }

  emitStats() {
    zmEvents.emit('stats', { height: this.currHeight, mempool: this.npcs.length, blockTime: this.blockTime });
  }

  /**
   * Reconcile the zebras on screen with the server snapshot.
   * @param {{txid: string, type: string}[]} mempool
   * @param {Map<string, number>|null} minedMap  txid → height (null = unknown)
   * @param {boolean} newBlock
   */
  syncNpcs(mempool, minedMap, newBlock) {
    const serverTxids = new Set(mempool.map((tx) => tx.txid));
    const inGrace = Date.now() < this.epochGraceUntil;

    // Split NPCs: still pending / mined (board the train) / gone (vanish)
    const kept = [];
    const boarding = [];
    for (const npc of this.npcs) {
      if (npc.isDestroyed) continue;
      if (serverTxids.has(npc.txid)) {
        kept.push(npc);
        continue;
      }
      const mined = minedMap ? minedMap.has(npc.txid) : newBlock;
      if (mined) {
        boarding.push(npc);
        this.rememberMined(npc.txid);
      } else if (inGrace) {
        kept.push(npc);
      } else {
        // Dropped / expired / evicted — not mined
        npc.cleanup();
      }
    }
    this.npcs = kept;

    if (newBlock || boarding.length) this.boardTrain(boarding, newBlock);

    this.spawnNewTransactions(mempool, minedMap);
    this.emitStats();
  }

  rememberMined(txid) {
    // Remember this txid so it won't be re-spawned as a ghost
    this.recentlyMined.add(txid);
    setTimeout(() => this.recentlyMined.delete(txid), 30000);
  }

  spawnNewTransactions(mempool, minedMap) {
    const pb = this.platformBounds;
    const present = new Set(this.npcs.map((n) => n.txid));

    // Add new transactions not yet represented by NPCs
    for (const tx of mempool) {
      if (present.has(tx.txid)) continue;
      // Skip recently-mined txids to prevent ghost re-spawns
      if (this.recentlyMined.has(tx.txid)) continue;
      if (minedMap && minedMap.has(tx.txid)) continue;
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
      present.add(tx.txid);

      if (!this.blured) {
        npc.moveAlongPath(path, false);
      } else {
        npc.setX(targetX * this.TILE);
        npc.setY(targetY * this.TILE);
        npc.canWander = true;
      }
    }
  }

  /**
   * Walk mined zebras to the nearest door, then (optionally) send the train.
   * @param {NPC[]} minedNpcs
   * @param {boolean} departs  true when a new block was mined
   */
  boardTrain(minedNpcs, departs) {
    const total = minedNpcs.length;
    if (total === 0) {
      if (departs) this.train.depart();
      return;
    }

    let boarded = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(safety);
      if (departs) this.train.depart();
    };
    // Safety: never wait more than 15s for stragglers before departing.
    const safety = setTimeout(() => {
      for (const npc of minedNpcs) npc.cleanup();
      finish();
    }, 15000);

    const onBoarded = () => {
      boarded++;
      this.emitStats();
      if (boarded >= total) finish();
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
  }
}

export default MainScene;
