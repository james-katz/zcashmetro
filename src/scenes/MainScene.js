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
 * Fixed resolution: 1080×840 (Phaser FIT scales to viewport).
 * Scale factor: 1080 / (45 * 12) = 2.0
 *
 * Visual layers (by depth):
 *   0  — Dark background fill (entire canvas)
 *   1  — Skyline image (upper portion only, behind station windows)
 *   3  — Station pillars (overlap skyline edges for depth effect)
 *   5  — Tilemap (collision grid — wall, track, platform tiles)
 *  10  — Train sprite
 *  15  — Decorative furniture sprites (from tileset_new)
 *  22  — NPCs (zebras)
 */
class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');

    /** @type {NPC[]} */
    this.npcs = [];
    this.dataLock = false;
    this.blockProcessing = false;
    this.lastTime = 0;
    this.timeInterval = 1000;
    this.blured = false;

    // Fixed scale: game is 1080px wide, tilemap is 45*12=540px native
    this.scaleFactor = 2.0;

    // Train door tile positions (row 21, spaced across the platform)
    this.doorPositions = [
      { x: 8, y: 21 },
      { x: 18, y: 21 },
      { x: 27, y: 21 },
      { x: 36, y: 21 },
    ];

    // Platform walkable bounds (tile coords)
    this.platformBounds = { minX: 1, maxX: 43, minY: 23, maxY: 33 };

    // Spawn point (bottom-center)
    this.spawnTile = { x: 22, y: 33 };
  }

  init(data) {
    this.npcData = data.npcData;
    this.currHeight = data.block.height;
  }

  create() {
    // --- Extract decorative sprite frames from tileset_new.png ---
    this.extractDecoFrames();

    // --- Layer 0: Dark background fill (blocks skyline from showing below) ---
    const bg = this.add.graphics();
    bg.fillStyle(0x0e0f18, 1);
    bg.fillRect(0, 0, 1080, 840);
    bg.setDepth(0);

    // --- Layer 1: Skyline (upper portion only, like subway windows) ---
    this.createSkyline();

    // --- Layer 5: Tilemap (collision grid) ---
    this.map = this.make.tilemap({ key: 'map' });
    const tileset = this.map.addTilesetImage('subway', 'tileset');
    const layer = this.map.createLayer(0, tileset);

    layer.setScale(this.scaleFactor);
    layer.setCollisionByProperty({ collides: true });
    layer.setDepth(5);

    this.physics.world.setBounds(0, 0, 1080, 840, true, true, true, true);

    // --- Layer 3: Station pillars (depth effect over skyline) ---
    this.createPillars();

    // --- Layer 10: Train ---
    this.train = new Train(
      this,
      22 * 12 * this.scaleFactor,
      16 * 12 * this.scaleFactor,
      'train',
      this.scaleFactor
    );
    this.physics.add.collider(this.train, layer);

    // --- Build navigation grid ---
    this.grid = [];
    for (let y = 0; y < this.map.height; y++) {
      const row = [];
      for (let x = 0; x < this.map.width; x++) {
        const tile = layer.getTileAt(x, y);
        row.push({ x, y, collides: tile ? tile.collides : false });
      }
      this.grid.push(row);
    }

    // --- Layer 15: Decorative furniture from new tileset ---
    this.placeFurniture();

    // --- Spawn initial NPCs ---
    const pb = this.platformBounds;
    for (const tx of this.npcData) {
      const posx = (pb.minX + Math.random() * (pb.maxX - pb.minX)) * 12 * this.scaleFactor;
      const posy = (pb.minY + Math.random() * (pb.maxY - pb.minY)) * 12 * this.scaleFactor;
      const npc = new NPC(this, tx, posx, posy, this.scaleFactor);
      npc.canWander = true;
      this.npcs.push(npc);
    }

    // Send initial stats to navbar
    zmEvents.emit('stats', { height: this.currHeight, mempool: this.npcs.length });

    // Camera doesn't scroll — fixed scene
    // (removed enableCameraScrolling)

    // Tab visibility
    this.game.events.on('blur', () => { this.blured = true; }, this);
    this.game.events.on('focus', () => { this.blured = false; }, this);
  }

  // ---------------------------------------------------------------------------
  // Decorative sprite frame extraction
  // ---------------------------------------------------------------------------

  /**
   * Extract named frames from tileset_new.png (1024×1024) for use as sprites.
   * Coordinates are approximate regions of each element in the AI-generated image.
   */
  extractDecoFrames() {
    const tex = this.textures.get('tileset_new');
    // Pillar/column (right side of row 3-4, gray metal)
    tex.add('deco_pillar', 0, 878, 170, 146, 500);
    // Red vending machine (row 3 left)
    tex.add('deco_vending_red', 0, 0, 292, 256, 240);
    // Blue vending machine (row 3 middle)
    tex.add('deco_vending_blue', 0, 256, 292, 256, 240);
    // Trash can (row 3)
    tex.add('deco_trash', 0, 512, 320, 100, 190);
    // Bench (row 3-4)
    tex.add('deco_bench', 0, 614, 340, 260, 120);
    // Zcash graffiti wall tile (row 2 right)
    tex.add('deco_graffiti', 0, 780, 170, 100, 120);
    // Concrete wall section (row 2)
    tex.add('deco_wall', 0, 0, 170, 170, 120);
    // Brick wall section (row 2)
    tex.add('deco_brick', 0, 512, 170, 268, 120);
  }

  // ---------------------------------------------------------------------------
  // Skyline — visible only through station "windows" in upper portion
  // ---------------------------------------------------------------------------

  createSkyline() {
    // The skyline covers only the top section (rows 0-7 = 0 to 192px at 2x scale)
    const skylineHeight = 8 * 12 * this.scaleFactor; // 192px

    const skyline = this.add.image(0, 0, 'skyline');
    skyline.setOrigin(0, 0);
    skyline.setDepth(1);

    // Scale to fill width, shift up to show building midsections
    const scaleX = 1080 / skyline.width;
    skyline.setScale(scaleX);

    // Crop vertically to only show within the skyline zone
    const cropH = Math.floor(skylineHeight / scaleX);
    // Show the lower-middle portion of the image (skip rooftops)
    const cropY = Math.floor(skyline.height * 0.3);
    skyline.setCrop(0, cropY, skyline.width, cropH);
    skyline.setY(0);

    // Twinkling stars
    for (let i = 0; i < 12; i++) {
      const x = Math.random() * 1080;
      const y = Math.random() * skylineHeight * 0.5;
      const star = this.add.circle(x, y, Math.random() < 0.3 ? 2 : 1, 0xffffff, 0.8);
      star.setDepth(2);
      this.tweens.add({
        targets: star,
        alpha: { from: 0.3, to: 1 },
        duration: 1500 + Math.random() * 2000,
        yoyo: true, repeat: -1,
        delay: Math.random() * 3000,
        ease: 'Stepped', easeParams: [2],
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Pillars — station columns that partially cover the skyline for depth
  // ---------------------------------------------------------------------------

  createPillars() {
    const skylineHeight = 8 * 12 * this.scaleFactor; // 192px
    const pillarScale = 0.5;
    const pillarSpacing = 135; // pixels between pillars

    for (let px = 0; px < 1080; px += pillarSpacing) {
      const pillar = this.add.image(px, 0, 'tileset_new', 'deco_pillar');
      pillar.setOrigin(0, 0);
      pillar.setScale(pillarScale);
      pillar.setDepth(3);
      // Crop to skyline height
      const maxH = Math.floor(skylineHeight / pillarScale);
      pillar.setCrop(0, 0, pillar.width, Math.min(pillar.height, maxH));
    }
  }

  // ---------------------------------------------------------------------------
  // Decorative furniture from the new tileset
  // ---------------------------------------------------------------------------

  placeFurniture() {
    const s = this.scaleFactor;
    const furnitureDepth = 15;
    const furnitureScale = 0.35;

    // Red vending machine — left wall area
    const vm1 = this.add.image(2 * 12 * s, 23.5 * 12 * s, 'tileset_new', 'deco_vending_red');
    vm1.setOrigin(0, 0).setScale(furnitureScale).setDepth(furnitureDepth);

    // Blue vending machine — next to red
    const vm2 = this.add.image(6 * 12 * s, 23.5 * 12 * s, 'tileset_new', 'deco_vending_blue');
    vm2.setOrigin(0, 0).setScale(furnitureScale).setDepth(furnitureDepth);

    // Bench — right side
    const bench = this.add.image(35 * 12 * s, 24 * 12 * s, 'tileset_new', 'deco_bench');
    bench.setOrigin(0, 0).setScale(furnitureScale).setDepth(furnitureDepth);

    // Trash can — near vending machines
    const trash = this.add.image(10 * 12 * s, 24 * 12 * s, 'tileset_new', 'deco_trash');
    trash.setOrigin(0, 0).setScale(furnitureScale * 0.8).setDepth(furnitureDepth);

    // Graffiti on wall — above platform, between pillars
    const graf1 = this.add.image(14 * 12 * s, 9 * 12 * s, 'tileset_new', 'deco_graffiti');
    graf1.setOrigin(0, 0).setScale(furnitureScale).setDepth(6); // above tilemap wall

    const graf2 = this.add.image(30 * 12 * s, 9 * 12 * s, 'tileset_new', 'deco_graffiti');
    graf2.setOrigin(0, 0).setScale(furnitureScale).setDepth(6);
  }

  // ---------------------------------------------------------------------------
  // Main update loop
  // ---------------------------------------------------------------------------

  update(time, _delta) {
    if (time - this.lastTime < this.timeInterval) return;
    this.lastTime = time;
    this.updateWandering(time);
    if (!this.dataLock) this.pollServer();
  }

  // ---------------------------------------------------------------------------
  // Wandering
  // ---------------------------------------------------------------------------

  updateWandering(time) {
    const pb = this.platformBounds;
    for (const npc of this.npcs) {
      if (this.blured) break;
      if (npc.isDestroyed) continue;
      if (Math.random() < 0.2) continue;

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

  async pollServer() {
    this.dataLock = true;
    try {
      const [mempoolRes, blockRes] = await Promise.all([
        http.get('/mempool'),
        http.get('/latestblock'),
      ]);
      const mempool = mempoolRes.data;
      const latestHeight = blockRes.data.height;
      await this.spawnNewTransactions(mempool);
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
  // Spawning
  // ---------------------------------------------------------------------------

  async spawnNewTransactions(mempool) {
    const pb = this.platformBounds;
    const s = this.scaleFactor;

    for (const tx of mempool) {
      if (this.npcs.some((npc) => npc.txid === tx.txid)) continue;

      const startTile = this.grid[this.spawnTile.y] && this.grid[this.spawnTile.y][this.spawnTile.x];
      if (!startTile) continue;

      let targetX = Math.floor(pb.minX + Math.random() * (pb.maxX - pb.minX));
      let targetY = Math.floor(pb.minY + Math.random() * (pb.maxY - pb.minY));

      for (let attempt = 0; attempt < 10; attempt++) {
        const cx = Math.floor(pb.minX + Math.random() * (pb.maxX - pb.minX));
        const cy = Math.floor(pb.minY + Math.random() * (pb.maxY - pb.minY));
        const ok = this.npcs.every((n) => {
          const dxPx = n.x - this.map.tileToWorldX(cx);
          const dyPx = n.y - this.map.tileToWorldY(cy);
          return Math.sqrt(dxPx * dxPx + dyPx * dyPx) >= 32;
        });
        if (ok) { targetX = cx; targetY = cy; break; }
      }

      const goal = this.grid[targetY] && this.grid[targetY][targetX];
      if (!goal) continue;

      try {
        const txInfoRes = await http.get(`/txinfo/?txid=${tx.txid}`);
        if (txInfoRes.data.height >= 0 && !txInfoRes.data.error) continue;
      } catch { continue; }

      const path = bfs(startTile, goal, this.grid);
      const npc = new NPC(
        this, tx,
        this.map.tileToWorldX(this.spawnTile.x),
        this.map.tileToWorldY(this.spawnTile.y),
        s
      );
      this.npcs.push(npc);

      if (!this.blured) {
        npc.moveAlongPath(path, false);
      } else {
        npc.setX(targetX * 12 * s);
        npc.setY(targetY * 12 * s);
        npc.canWander = true;
      }
    }

    zmEvents.emit('stats', { height: this.currHeight, mempool: this.npcs.length });
  }

  // ---------------------------------------------------------------------------
  // Block handling
  // ---------------------------------------------------------------------------

  async handleNewBlock() {
    if (this.blockProcessing) return;
    this.blockProcessing = true;

    const minedNpcs = [];
    const keptNpcs = [];

    for (const npc of this.npcs) {
      if (npc.isDestroyed) continue;
      try {
        const res = await http.get(`/txinfo/?txid=${npc.txid}`);
        if (res.data.height > 0) minedNpcs.push(npc);
        else keptNpcs.push(npc);
      } catch { keptNpcs.push(npc); }
    }

    this.npcs = keptNpcs;

    if (minedNpcs.length === 0) {
      this.train.depart();
      zmEvents.emit('stats', { height: this.currHeight, mempool: this.npcs.length });
      this.blockProcessing = false;
      return;
    }

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

      if (this.blured) { npc.cleanup(); onNpcBoarded(); continue; }

      const startX = this.map.worldToTileX(npc.x);
      const startY = this.map.worldToTileY(npc.y);
      const start = this.grid[startY] && this.grid[startY][startX];

      if (!start) { npc.cleanup(); onNpcBoarded(); continue; }

      const pathToTrain = bfsClosestDoor(start, this.doorPositions, this.grid);
      if (pathToTrain.length === 0) { npc.cleanup(); onNpcBoarded(); continue; }

      npc.moveAlongPath(pathToTrain, true, () => { onNpcBoarded(); });
    }

    zmEvents.emit('stats', { height: this.currHeight, mempool: this.npcs.length });
    this.blockProcessing = false;
  }
}

export default MainScene;
