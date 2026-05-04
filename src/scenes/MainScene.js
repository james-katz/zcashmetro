import Phaser from 'phaser';
import NPC from '../objects/npc';
import Train from '../objects/train';
import http from '../http-common';
import { bfs, bfsClosestDoor } from '../pathfinding';
import zmEvents from '../events';

/**
 * MainScene — fully rendered station scene (no Tiled tilemap).
 *
 * Fixed resolution: 1080×840, tile unit = 24px (12px * scaleFactor 2.0).
 *
 * Layout (rows of 24px):
 *   0-7   (y 0–192):   Upper station — walls L/R, skyline center opening
 *   8-11  (y 192–288):  Concrete wall below skyline
 *   12-16 (y 288–408):  Track area (gravel, rails)
 *   17    (y 408–432):  Yellow hazard line (with 4 door gaps)
 *   18    (y 432–456):  Tactile safety strip
 *   19-33 (y 456–816):  Platform floor (walkable)
 *   34    (y 816–840):  Bottom edge
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

    this.TILE = 24;         // 12px native * 2.0 scale
    this.COLS = 45;
    this.ROWS = 35;
    this.scaleFactor = 2.0;

    // Skyline opening (tile columns)
    this.wallLeftEnd = 7;   // tiles 0-6 = left wall
    this.wallRightStart = 38; // tiles 38-44 = right wall

    // Train door positions
    this.doorPositions = [
      { x: 8, y: 18 }, { x: 18, y: 18 },
      { x: 27, y: 18 }, { x: 36, y: 18 },
    ];

    this.platformBounds = { minX: 1, maxX: 43, minY: 19, maxY: 33 };
    this.spawnTile = { x: 22, y: 33 };
  }

  init(data) {
    this.npcData = data.npcData;
    this.currHeight = data.block.height;
  }

  create() {
    const T = this.TILE;

    // Extract sprite frames from tileset_new.png
    this.extractDecoFrames();

    // --- Build collision grid (code-based, no tilemap) ---
    this.buildGrid();

    // --- Render scene layers ---
    this.renderBackground();        // depth 0: dark fill
    this.renderSkyline();           // depth 1: skyline in center opening
    this.renderStationWalls();      // depth 2-3: walls framing skyline
    this.renderWallBelow();         // depth 4: concrete wall below skyline
    this.renderTracks();            // depth 5: gravel + rails
    this.renderHazardLine();        // depth 6: yellow hazard + tactile
    this.renderPlatformFloor();     // depth 7: tiled floor from tileset_new

    // --- Train (depth 10) ---
    this.train = new Train(this, 22 * T, 13.5 * T, 'train', this.scaleFactor);



    // --- Spawn NPCs ---
    const pb = this.platformBounds;
    for (const tx of this.npcData) {
      const posx = (pb.minX + Math.random() * (pb.maxX - pb.minX)) * T;
      const posy = (pb.minY + Math.random() * (pb.maxY - pb.minY)) * T;
      const npc = new NPC(this, tx, posx, posy, this.scaleFactor);
      npc.canWander = true;
      this.npcs.push(npc);
    }

    zmEvents.emit('stats', { height: this.currHeight, mempool: this.npcs.length });

    this.game.events.on('blur', () => { this.blured = true; }, this);
    this.game.events.on('focus', () => { this.blured = false; }, this);
  }

  // ---------------------------------------------------------------------------
  // Sprite frame extraction from tileset_new.png (1024×1024)
  // ---------------------------------------------------------------------------

  extractDecoFrames() {
    const tex = this.textures.get('tileset_new');
    // Floor tiles (row 0) — degraded white with grout lines
    // Inset by 6px on each edge to avoid black grid borders
    tex.add('floor_1', 0, 10, 10, 150, 150);
    tex.add('floor_2', 0, 178, 10, 150, 150);
    tex.add('floor_3', 0, 346, 10, 150, 150);
    tex.add('floor_4', 0, 516, 10, 150, 150);
    // Yellow tactile tile (inset)
    tex.add('tactile', 0, 691, 10, 153, 150);
    // Concrete wall (inset)
    tex.add('wall_concrete', 0, 10, 180, 150, 100);
    // Brick wall (inset)
    tex.add('wall_brick', 0, 522, 180, 114, 100);
    tex.add('wall_brick2', 0, 652, 180, 114, 100);
    // Graffiti wall (inset)
    tex.add('wall_graffiti', 0, 786, 180, 88, 100);
    // Track/gravel (inset)
    tex.add('gravel', 0, 10, 642, 150, 126);
    tex.add('track_rail', 0, 346, 642, 328, 126);
    // Hazard stripe (inset)
    tex.add('hazard', 0, 10, 790, 150, 84);
  }

  // ---------------------------------------------------------------------------
  // Code-based collision grid (replaces Tiled tilemap)
  // ---------------------------------------------------------------------------

  buildGrid() {
    this.grid = [];
    for (let y = 0; y < this.ROWS; y++) {
      const row = [];
      for (let x = 0; x < this.COLS; x++) {
        let collides = true; // default: not walkable

        // Platform floor (walkable)
        if (y >= 19 && y <= 33 && x >= 1 && x <= 43) {
          collides = false;
        }

        // Door gaps in hazard line (walkable paths to train)
        if (y === 18) {
          for (const door of this.doorPositions) {
            if (Math.abs(x - door.x) <= 1) collides = false;
          }
        }



        row.push({ x, y, collides });
      }
      this.grid.push(row);
    }
  }

  /** Convert world X to tile X */
  worldToTileX(wx) { return Math.floor(wx / this.TILE); }
  /** Convert world Y to tile Y */
  worldToTileY(wy) { return Math.floor(wy / this.TILE); }
  /** Convert tile X to world X */
  tileToWorldX(tx) { return tx * this.TILE; }
  /** Convert tile Y to world Y */
  tileToWorldY(ty) { return ty * this.TILE; }

  // ---------------------------------------------------------------------------
  // Scene rendering
  // ---------------------------------------------------------------------------

  renderBackground() {
    const g = this.add.graphics();
    g.fillStyle(0x0e0f18, 1);
    g.fillRect(0, 0, 1080, 840);
    g.setDepth(0);
  }

  renderSkyline() {
    const T = this.TILE;
    const openLeft = this.wallLeftEnd * T;     // 168
    const openRight = this.wallRightStart * T; // 912
    const openWidth = openRight - openLeft;    // 744
    const skyH = 8 * T; // 192

    const sky = this.add.image(openLeft, 0, 'skyline');
    sky.setOrigin(0, 0);
    sky.setDepth(1);

    // Scale to fill the opening width, then crop to show neon city portion
    const scaleX = openWidth / sky.width;
    sky.setScale(scaleX);

    // Show the neon-heavy building midsection (Zcash logos, pink neon strips)
    const cropY = Math.floor(sky.height * 0.30);
    const cropH = Math.floor(skyH / scaleX);
    sky.setCrop(0, cropY, sky.width, cropH);

  }

  renderStationWalls() {
    const T = this.TILE;
    const skyH = 8 * T;
    const wallColor = 0x1a1b2e;
    const wallAccent = 0x252640;

    // Left wall
    const gLeft = this.add.graphics();
    gLeft.fillStyle(wallColor, 1);
    gLeft.fillRect(0, 0, this.wallLeftEnd * T, skyH);
    gLeft.setDepth(2);

    // Right wall
    const gRight = this.add.graphics();
    gRight.fillStyle(wallColor, 1);
    gRight.fillRect(this.wallRightStart * T, 0, (this.COLS - this.wallRightStart) * T, skyH);
    gRight.setDepth(2);

    // Wall edge accents (thin lines framing the opening)
    const gEdge = this.add.graphics();
    gEdge.fillStyle(wallAccent, 1);
    gEdge.fillRect(this.wallLeftEnd * T - 4, 0, 8, skyH);
    gEdge.fillRect(this.wallRightStart * T - 4, 0, 8, skyH);
    gEdge.setDepth(3);


  }

  renderWallBelow() {
    const T = this.TILE;
    const wallY = 8 * T;   // 192
    const wallH = 4 * T;   // 96
    const tileW = 162;

    // Tile the concrete wall using tileset_new sprites
    const wallScale = (T * 2) / tileW; // scale tiles to ~2 tile widths
    for (let x = 0; x < 1080; x += Math.floor(tileW * wallScale)) {
      // Alternate concrete and brick
      const frameKey = (x / Math.floor(tileW * wallScale)) % 3 === 1 ? 'wall_brick' : 'wall_concrete';
      const wt = this.add.image(x, wallY, 'tileset_new', frameKey);
      wt.setOrigin(0, 0).setScale(wallScale, wallH / 112).setDepth(4);
    }

    // Graffiti overlays on the wall
    const grafScale = 0.5;
    const graf1 = this.add.image(12 * T, wallY + 10, 'tileset_new', 'wall_graffiti');
    graf1.setOrigin(0, 0).setScale(grafScale).setDepth(4);
    const graf2 = this.add.image(30 * T, wallY + 10, 'tileset_new', 'wall_graffiti');
    graf2.setOrigin(0, 0).setScale(grafScale).setDepth(4);
  }

  renderTracks() {
    const T = this.TILE;
    const trackY = 12 * T;  // 288
    const trackH = 5 * T;   // 120

    // Gravel base
    const gravelScale = trackH / 138;
    for (let x = 0; x < 1080; x += Math.floor(162 * gravelScale * 1.2)) {
      const frameKey = Math.random() < 0.5 ? 'gravel' : 'track_rail';
      const gt = this.add.image(x, trackY, 'tileset_new', frameKey);
      gt.setOrigin(0, 0);
      gt.setDisplaySize(Math.floor(162 * gravelScale * 1.2), trackH);
      gt.setDepth(5);
    }

    // Rail lines (steel gray)
    const gRails = this.add.graphics();
    gRails.lineStyle(3, 0x888898, 1);
    gRails.moveTo(0, trackY + trackH * 0.35).lineTo(1080, trackY + trackH * 0.35);
    gRails.moveTo(0, trackY + trackH * 0.65).lineTo(1080, trackY + trackH * 0.65);
    gRails.strokePath();
    gRails.setDepth(5);
  }

  renderHazardLine() {
    const T = this.TILE;
    const hazardY = 17 * T; // 408
    const tactileY = 18 * T; // 432

    // Hazard stripe using tileset_new
    const hScale = T / 96;
    for (let x = 0; x < 1080; x += Math.floor(162 * hScale)) {
      // Skip door gaps
      const tileX = Math.floor(x / T);
      let isDoor = false;
      for (const door of this.doorPositions) {
        if (Math.abs(tileX - door.x) <= 1) isDoor = true;
      }
      if (isDoor) continue;

      const h = this.add.image(x, hazardY, 'tileset_new', 'hazard');
      h.setOrigin(0, 0).setDisplaySize(Math.floor(162 * hScale), T).setDepth(6);
    }

    // Tactile strip using tileset_new yellow tile
    const tScale = T / 162;
    for (let x = 0; x < 1080; x += Math.floor(162 * tScale)) {
      const tileX = Math.floor(x / T);
      let isDoor = false;
      for (const door of this.doorPositions) {
        if (Math.abs(tileX - door.x) <= 1) isDoor = true;
      }
      if (isDoor) continue;

      const tt = this.add.image(x, tactileY, 'tileset_new', 'tactile');
      tt.setOrigin(0, 0).setDisplaySize(Math.floor(162 * tScale), T).setDepth(6);
    }
  }

  renderPlatformFloor() {
    const T = this.TILE;
    const floorY = 19 * T; // 456
    const floorH = 15 * T; // 360 (rows 19-33)
    const floorFrames = ['floor_1', 'floor_2', 'floor_3', 'floor_4'];
    const tileSize = T * 4; // each floor tile covers 4x4 game tiles (scaled 2x bigger)

    for (let y = floorY; y < floorY + floorH; y += tileSize) {
      for (let x = 0; x < 1080; x += tileSize) {
        const frame = floorFrames[((x / tileSize | 0) + (y / tileSize | 0)) % 4];
        const ft = this.add.image(x, y, 'tileset_new', frame);
        ft.setOrigin(0, 0).setDisplaySize(tileSize, tileSize).setDepth(7);
      }
    }
  }



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
    const T = this.TILE;
    const pb = this.platformBounds;

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
          const dx = n.x - cx * T; const dy = n.y - cy * T;
          return Math.sqrt(dx * dx + dy * dy) >= 32;
        })) { targetX = cx; targetY = cy; break; }
      }

      const goal = this.grid[targetY] && this.grid[targetY][targetX];
      if (!goal) continue;

      try {
        const r = await http.get(`/txinfo/?txid=${tx.txid}`);
        if (r.data.height >= 0 && !r.data.error) continue;
      } catch { continue; }

      const path = bfs(startTile, goal, this.grid);
      const npc = new NPC(this, tx, this.spawnTile.x * T, this.spawnTile.y * T, this.scaleFactor);
      this.npcs.push(npc);

      if (!this.blured) {
        npc.moveAlongPath(path, false);
      } else {
        npc.setX(targetX * T); npc.setY(targetY * T); npc.canWander = true;
      }
    }
    zmEvents.emit('stats', { height: this.currHeight, mempool: this.npcs.length });
  }

  async handleNewBlock() {
    if (this.blockProcessing) return;
    this.blockProcessing = true;

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
      this.blockProcessing = false;
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
    this.blockProcessing = false;
  }
}

export default MainScene;
