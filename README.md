# Zcash mempool Visualizer
A project for visualizing transactions in the Zcash mempool.

## Basic structure
This project is split into a server and a Phaser front end
```
./
├── src <- Phaser "game" logic here
│   └── [...]
└── server <- The backend server is here
    ├── database <- Sequelize database stuff
    └── src <- Rust lib for transaction decoding
```
## How to use
Edit `src/http-common.js` and set up server url.
```
npm install
npm run dev

or

cd server
npm run build
cd ..
npm run build
```
You may also need to copy `assets` directory files into `build` directory.
