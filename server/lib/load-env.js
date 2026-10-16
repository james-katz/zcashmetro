/** Load server/.env before any configuration modules read process.env. */
const path = require('path');
const dotenv = require('dotenv');

const envFile = process.env.ENV_FILE
  ? path.resolve(process.env.ENV_FILE)
  : path.join(__dirname, '..', '.env');

// Existing shell/PM2 variables take precedence over values in the file.
dotenv.config({ path: envFile, quiet: true });

