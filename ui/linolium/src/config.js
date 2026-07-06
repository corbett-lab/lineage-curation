// Backend base URL.
//
// Default (single-origin): the backend is reverse-proxied behind the frontend's
// own origin (see the `proxy` config in vite.config.js), so API calls go to the
// same host:port that served the page. This means the app runs on ONE port and
// works no matter which host/port it's exposed on — nothing is baked in.
//
// Escape hatch: set VITE_BACKEND_URL to point the frontend at a different backend
// origin (e.g. a separately-hosted API). Rarely needed.
export const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:8001");
