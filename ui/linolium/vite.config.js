import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import tailwindcss from '@tailwindcss/vite'

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
    fs: {
      allow: [
        // Allow serving files from the parent directory
        '..',
      ],
    },
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
