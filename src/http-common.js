import axios from "axios";

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

// In production, use the same hostname and protocol as the page, but connect
// directly to the Node API on port 3000. VITE_API_URL remains available for
// deployments that use a different host or port.
const apiBaseUrl = configuredApiUrl || (
  import.meta.env.DEV
    ? "http://localhost:3000"
    : `${window.location.protocol}//${window.location.hostname}:3000`
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
