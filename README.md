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
│  lightwalletd    │◄────────────────────►│ Node supervisor  │
│  (Zcash node)    │                      │  ┌────────────┐  │
└─────────────────┘                      │  │ API worker   │  │  ← self-healing
                                         │  │ + mempool   │  │  ← in memory
                                         │  └────────────┘  │
                                         │  ┌────────────┐  │
                                         │  │ Rust/Neon   │  │  ← tx decoding
                                         │  │ (index.node)│  │
                                         │  └────────────┘  │
                                         │  REST API :3000  │
                                         └────────┬─────────┘
                                                  │ HTTP
                                         ┌────────▼─────────┐
                                         │  Phaser 3 Client │
                                         │  (Vite dev/build) │
                                         └──────────────────┘
```

### How it works

1. The **server worker** opens a gRPC stream (`GetMempoolStream`) to a lightwalletd instance. Each incoming raw transaction is decoded by a **Rust native module** (via [Neon](https://neon-bindings.com)) and classified by pool type (transparent, Sapling, Orchard, or Ironwood).

2. Decoded transactions are held in memory. The worker polls the chain tip and reconciles mined, dropped, and expired transactions before publishing each new snapshot. RPC deadlines, stream rotation, failover, and watchdogs recover from unhealthy lightwalletd connections.

3. A small **supervisor process** monitors worker heartbeats. If the worker crashes or blocks its event loop, it is restarted with a clean state and exponential backoff.

4. The **Phaser client** polls the atomic `/state` snapshot every second. New transactions spawn as zebra NPCs; mined transactions walk to the train and board. It also handles server epoch changes without turning temporary gaps into ghost removals.

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
    ├── index.js             ← Worker supervisor
    ├── app.js               ← Express API worker
    ├── grpc_connector.js    ← gRPC client wrapper
    ├── lib/                 ← Mempool engine, store, decoder, config
    ├── proto/service.proto  ← lightwalletd protobuf definitions
    ├── src/lib.rs           ← Rust transaction decoder (Neon)
    ├── test/                ← Node and decoder regression tests
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

| Setting | Environment variable | Default |
|---|---|---|
| gRPC server URL(s), comma-separated | `GRPC_SERVER_URL` | `infra.zcashbr.com:9067` |
| Plaintext gRPC | `GRPC_PLAINTEXT` | `false` |
| RPC deadline | `RPC_DEADLINE_MS` | `8000` |
| API bind address | `HOST` | `0.0.0.0` |
| API port | `PORT` | `3000` |
| HTTPS mode | `USE_HTTPS` | `false` |
| TLS files | `SSL_KEY`, `SSL_CERT` | `privkey.pem`, `cert.pem` |
| Log verbosity | `LOG_LEVEL` | `info` |
| Client API URL (build time) | `VITE_API_URL` | Current hostname on port `3000`; `http://localhost:3000` in development |

Additional watchdog and reconciliation intervals can be overridden with the variables documented in `server/lib/config.js`.

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

### HTTPS in production

The frontend connects directly to port `3000` using the same protocol as the page. For `https://zcashmetro.io`, its default API URL is therefore `https://zcashmetro.io:3000`.

Copy the server environment template once and edit it:

```bash
cp server/.env.example server/.env
nano server/.env
pm2 restart ZcashMetro
```

The server loads `server/.env` on every start, regardless of PM2's working directory. Shell or PM2 environment variables override values from the file. Verify the result with `curl https://zcashmetro.io:3000/latestblock`. The certificate must cover `zcashmetro.io`, and the user running PM2 must have permission to read both certificate files.

To use another API address, set `VITE_API_URL` while building the frontend:

```bash
VITE_API_URL=https://api.example.com npm run build
```

`VITE_API_URL` is a frontend build-time setting, unlike the server variables above. It can also be placed in a root `.env.production` file before running `npm run build`.

### Native addon deployments

`server/index.node` is generated and ignored by Git, so a code pull does not update it. Build it on the production machine before restarting PM2:

```bash
cd server
npm ci
npm run build-release
node -p "Object.keys(require('./index.node'))"
cd ..
pm2 restart ZcashMetro --update-env
```

The exported keys should include `decodeTransaction`. The server temporarily supports the older `getTransactionData` export for rolling deployments, but rebuilding is the permanent fix.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Basic API response |
| `/mempool` | GET | Returns all mempool transactions `[{ txid, type }]` |
| `/latestblock` | GET | Returns `{ height, blockTime }` for the latest block |
| `/txinfo?txid=<hex>` | GET | Returns `{ height }` (> 0 if mined, -1 if unconfirmed) |
| `/state` | GET | Returns one atomic `{ epoch, status, height, blockTime, mempool, mined }` snapshot |
| `/health` | GET | Returns worker, stream, tip, memory, and watchdog diagnostics |

The `/api/*` aliases also remain available.

## Tests

From the repository root, `npm test` runs the Rust unit tests and the Node service/decoder regression tests. `npm run build` creates the production frontend bundle.

## License

ISC
