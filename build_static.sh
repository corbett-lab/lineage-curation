
set -e
cd /repo/ui/linolium
echo "=== npm install (root) ==="
npm install --no-audit --no-fund 2>&1 | tail -3
echo "=== build:component ==="
cd taxonium_component && npm install --no-audit --no-fund 2>&1 | tail -3 && NODE_OPTIONS="--max-old-space-size=8192" npm run build 2>&1 | tail -8
cd ..
echo "=== build:data-handling ==="
cd taxonium_data_handling && npm install --no-audit --no-fund 2>&1 | tail -3
cd ..
echo "=== build:app (vite build, backendless/static) ==="
# VITE_BACKENDLESS=1 selects the static (in-browser Pyodide/WASM) build. The app's
# config.js is dual-mode behind this flag; without it, `vite build` would produce
# the server build, which cannot work on a static host with no backend.
VITE_BACKENDLESS=1 NODE_OPTIONS="--max-old-space-size=8192" npx vite build 2>&1 | tail -25
echo "=== BUILD DONE ==="
ls -la dist/ | head
