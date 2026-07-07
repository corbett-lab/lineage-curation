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

// Build mode switch (single source of truth for server-vs-backendless).
//
//   BACKENDLESS === false (default)  → server mode: the app talks to the
//       taxonium_backend server (Docker / local). Behavior is unchanged from
//       the classic build — this is what `docker build` and local dev produce.
//
//   BACKENDLESS === true             → backendless (static web) mode: the whole
//       pipeline runs in the browser (Pyodide + WASM ports), no server is
//       contacted. Set VITE_BACKENDLESS=1 at build time (e.g. on Vercel).
//
// The flag is read once at build time; unset/anything-but-"1" means server mode,
// so existing Docker/local builds are entirely unaffected.
export const BACKENDLESS = import.meta.env.VITE_BACKENDLESS === "1";
