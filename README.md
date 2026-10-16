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
| Client API URL (build time) | `VITE_API_URL` | `/api` on the production page's origin; `http://localhost:3000` in development |

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

The recommended setup is to terminate HTTPS in Nginx or Caddy, serve `dist/` there, and proxy `/api/` to the Node worker over localhost. Keep Node itself on HTTP:

```bash
HOST=127.0.0.1 PORT=3000 USE_HTTPS=false pm2 restart ZcashMetro --update-env
```

Example Nginx server block:

```nginx
server {
    listen 443 ssl;
    server_name zcashmetro.io;

    ssl_certificate     /etc/letsencrypt/live/zcashmetro.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/zcashmetro.io/privkey.pem;

    root /path/to/phaser-hello-world/dist;

    location /api/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

With that layout, the frontend automatically uses `https://zcashmetro.io/api`; no production `VITE_API_URL` is needed. For a separate API origin, set it when building the frontend:

```bash
VITE_API_URL=https://api.zcashmetro.io npm run build
```

Direct TLS from Node is also supported when a reverse proxy is not available:

```bash
USE_HTTPS=true HOST=0.0.0.0 PORT=3000 \
SSL_KEY=/etc/letsencrypt/live/zcashmetro.io/privkey.pem \
SSL_CERT=/etc/letsencrypt/live/zcashmetro.io/fullchain.pem \
npm start
```

In that case, build the frontend with `VITE_API_URL=https://zcashmetro.io:3000`.

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
| `/api` | GET | Basic API response |
| `/api/mempool` | GET | Returns all mempool transactions `[{ txid, type }]` |
| `/api/latestblock` | GET | Returns `{ height, blockTime }` for the latest block |
| `/api/txinfo?txid=<hex>` | GET | Returns `{ height }` (> 0 if mined, -1 if unconfirmed) |
| `/api/state` | GET | Returns one atomic `{ epoch, status, height, blockTime, mempool, mined }` snapshot |
| `/api/health` | GET | Returns worker, stream, tip, memory, and watchdog diagnostics |

The original unprefixed endpoint paths remain available for compatibility and for proxies that strip `/api`.

## Tests

From the repository root, `npm test` runs the Rust unit tests and the Node service/decoder regression tests. `npm run build` creates the production frontend bundle.

## License

ISC
