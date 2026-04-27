# ZcashMetro — Zcash Mempool Visualizer

A real-time visualizer for the [Zcash](https://z.cash) mempool, built as an interactive pixel-art train station using [Phaser 3](https://phaser.io/).

**Transactions are zebras. Blocks are trains.**

When new transactions enter the mempool, zebra NPCs spawn and wander around the station platform. When a block is mined, the mined zebras walk to the train, board it, and the train departs — then a new train arrives for the next block.

Each zebra shows its transaction type with a shield badge:
- 🟤 **Bronze** — Shielding (t→z/o) or Deshielding (z/o→t)
- 🩶 **Silver** — Partially Shielded (z↔o)
- 🟡 **Gold** — Fully Shielded (z→z, o→o)

Click any zebra to open the transaction on [Zcash Explorer](https://mainnet.zcashexplorer.app).

## Architecture

```
┌─────────────────┐      gRPC (TLS)      ┌──────────────────┐
│  lightwalletd    │◄────────────────────►│  Node.js Server  │
│  (Zcash node)    │                      │                  │
└─────────────────┘                      │  ┌────────────┐  │
                                         │  │ Rust/Neon   │  │  ← tx decoding
                                         │  │ (index.node)│  │
                                         │  └────────────┘  │
                                         │  ┌────────────┐  │
                                         │  │ SQLite DB   │  │  ← mempool state
                                         │  │ (Sequelize) │  │
                                         │  └────────────┘  │
                                         │                  │
                                         │  REST API :3000  │
                                         └────────┬─────────┘
                                                  │ HTTP
                                         ┌────────▼─────────┐
                                         │  Phaser 3 Client │
                                         │  (Vite dev/build) │
                                         └──────────────────┘
```

### How it works

1. The **server** opens a gRPC stream (`GetMempoolStream`) to a lightwalletd instance. Each incoming raw transaction is decoded by a **Rust native module** (via [Neon](https://neon-bindings.com)) and classified by pool type (transparent, sapling, orchard).

2. Decoded transactions are stored in a **SQLite database** (via Sequelize). When the stream closes (block boundary), the server checks which transactions were mined and removes them from the DB.

3. The **Phaser client** polls the server's REST API every second for mempool contents and the latest block height. New transactions spawn as zebra NPCs; mined transactions walk to the train and board.

## Project Structure

```
./
├── main.js                 ← Phaser game config & entry point
├── index.html              ← HTML shell
├── src/
│   ├── http-common.js      ← Axios instance (API base URL)
│   ├── pathfinding.js      ← BFS pathfinding on the tile grid
│   ├── scenes/
│   │   ├── LoadingScene.js  ← Asset preloading & initial data fetch
│   │   └── MainScene.js    ← Core game logic (polling, spawning, boarding)
│   └── objects/
│       ├── npc.js           ← Zebra NPC (transaction)
│       ├── train.js         ← Train (block)
│       ├── sign.js          ← Station info signs
│       └── tooltip.js       ← Hover tooltip for tx details
├── assets/                  ← Sprites, tilemap, favicon
└── server/
    ├── index.js             ← Express server + gRPC stream handler
    ├── grpc_connector.js    ← gRPC client wrapper
    ├── proto/service.proto  ← lightwalletd protobuf definitions
    ├── database/            ← Sequelize config + models
    ├── src/lib.rs           ← Rust transaction decoder (Neon)
    ├── Cargo.toml
    └── package.json
```

## Prerequisites

- **Node.js** ≥ 18
- **Rust** toolchain (for building the Neon native module)
- **cargo-cp-artifact**: `npm install -g cargo-cp-artifact`
- Access to a **lightwalletd** gRPC server (e.g. `infra.zcashbr.com:9067`)

## Setup & Build

### Server (Rust + Node)

```bash
cd server
npm install        # builds the Rust native module via cargo
```

This compiles `src/lib.rs` into `index.node` and installs Node dependencies.

### Client (Phaser + Vite)

```bash
# From the project root
npm install
```

## Configuration

| Setting | Location | Default |
|---|---|---|
| gRPC server URL | `server/index.js` or env `GRPC_SERVER_URL` | `infra.zcashbr.com:9067` |
| API port | `server/index.js` or env `PORT` | `3000` |
| HTTPS mode | `server/index.js` (`useHttps`) | `false` |
| Client API URL | `src/http-common.js` | `https://zcashmetro.io:3000` |

## Running

### Development (server + client with hot reload)

```bash
npm run dev
```

This starts both the Express server (with nodemon) and the Vite dev server concurrently.

### Production

```bash
# Build the server native module
cd server && npm run build-release && cd ..

# Build the Vite client
npm run build

# Start the server
npm start
```

The built client files are output to `dist/`.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Health check |
| `/mempool` | GET | Returns all mempool transactions `[{ txid, type }]` |
| `/latestblock` | GET | Returns `{ height }` of the latest block |
| `/txinfo?txid=<hex>` | GET | Returns `{ height }` (> 0 if mined, -1 if unconfirmed) |

## License

ISC
