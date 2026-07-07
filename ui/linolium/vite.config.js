import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import tailwindcss from '@tailwindcss/vite'

// Single-origin setup: reverse-proxy the backend (express) API routes through the
// frontend server so the whole app is reachable on ONE port. The backend stays
// internal (never exposed to the host), so there is no second port to configure
// and no host-port conflict. Override the internal backend port with BACKEND_PORT.
const backendPort = process.env.BACKEND_PORT || '8001'
const apiProxyTarget = `http://localhost:${backendPort}`

// In the Docker dev container, vite listens on 3000 internally but the browser
// reaches it via the host-published port ($PORT, passed as HMR_CLIENT_PORT). The
// HMR client otherwise assumes the internal port, so its WebSocket connects to the
// wrong port and HMR silently fails whenever PORT != 3000.
const hmrClientPort = process.env.HMR_CLIENT_PORT ? Number(process.env.HMR_CLIENT_PORT) : undefined

// Backend routes to forward. The SPA owns everything else (including '/').
// Keep in sync with the express routes in taxonium_backend/server.js.
const apiRoutes = [
  '/upload', '/run-autolin', '/download', '/reload-data', '/search',
  '/config', '/lineages', '/mutations', '/nodes', '/merge-lineage',
  '/edit-history', '/undo-preview', '/undo-edit', '/edit-lineage-root',
  '/node_details', '/tip_atts', '/nextstrain_json', '/export',
]
const apiProxy = Object.fromEntries(
  apiRoutes.map((route) => [route, { target: apiProxyTarget, changeOrigin: true }])
)

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({
      // Whether to polyfill `node:` protocol imports.
      protocolImports: true,
      // Whether to polyfill specific globals.
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      // Whether to polyfill specific modules.
      include: [
        'buffer',
        'crypto',
        'events',
        'http',
        'https',
        'os',
        'path',
        'stream',
        'string_decoder',
        'timers',
        'url',
        'util',
        'zlib'
      ],
    }),
  ],
  server: {
    port: 5175,
    proxy: apiProxy,
    // Point the HMR WebSocket at the host-published port so it works on any PORT.
    hmr: hmrClientPort ? { clientPort: hmrClientPort } : true,
    fs: {
      allow: [
        // Allow serving files from the parent directory
        '..',
      ],
    },
  },
  preview: {
    proxy: apiProxy,
  },
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
    alias: {
      'stream/web': 'stream-browserify',
      'stream': 'stream-browserify'
    }
  },
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['stream-browserify'],
  },
})
