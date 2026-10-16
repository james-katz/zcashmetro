import axios from "axios";

export default axios.create({
  // Override with VITE_API_URL (e.g. in .env.development.local) for local dev.
  baseURL: import.meta.env.VITE_API_URL || "https://zcashmetro.io:3000",
  // Never wait forever: a hung request used to keep the scene's poll lock
  // held indefinitely, freezing the station.
  timeout: 10000,
  headers: {
    "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
  }
});
