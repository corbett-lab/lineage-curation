#!/bin/bash
# Dev mode: mounts source into container, builds component, runs vite dev server.
# Much faster than full docker build — only rebuilds the JS component.
#
# Single-origin: the app is reachable on ONE port (3000). The backend runs
# internally and vite reverse-proxies API calls to it, so there is no second
# port to expose and no host-port conflict. Change the host port freely:
#   PORT=8080 ./dev.sh      # open http://localhost:8080
# BACKEND_PORT only sets the *internal* backend port (rarely needs changing).
PORT="${PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-8001}"
docker run -it --rm --memory=8g \
  -v "$PWD/ui/linolium/src":/app/ui/src \
  -v "$PWD/ui/linolium/vite.config.js":/app/ui/vite.config.js \
  -v "$PWD/ui/linolium/taxonium_component/src":/app/ui/taxonium_component/src \
  -v "$PWD/ui/linolium/taxonium_backend":/app/ui/taxonium_backend \
  -v "$PWD/autolin":/app/autolin \
  -v "$PWD":/data \
  -e BACKEND_PORT="$BACKEND_PORT" \
  -p "$PORT:3000" \
  linolium bash -c '
    source /opt/conda/etc/profile.d/conda.sh && conda activate taxalin &&
    echo "Building component..." &&
    cd /app/ui/taxonium_component && npm run build 2>&1 | tail -3 &&
    cd /app/ui/taxonium_backend && node server.js --port "$BACKEND_PORT" &
    sleep 2 &&
    cd /app/ui && npx vite --port 3000 --host 0.0.0.0 &
    wait
  '
