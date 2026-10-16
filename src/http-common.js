import axios from "axios";

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

// Production defaults to the page's own HTTPS origin. Put the API behind the
// same reverse proxy as the static site and no URL configuration is needed.
// Split-origin deployments can still set VITE_API_URL at build time.
const apiBaseUrl = configuredApiUrl || (
  import.meta.env.DEV ? "http://localhost:3000" : `${window.location.origin}/api`
);

export default axios.create({
  baseURL: apiBaseUrl,
  // Never wait forever: a hung request used to keep the scene's poll lock
  // held indefinitely, freezing the station.
  timeout: 10000,
  headers: {
    "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
  }
});
