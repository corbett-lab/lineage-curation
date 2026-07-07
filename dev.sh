#!/bin/bash
# Dev mode: mounts source into the container, builds the JS component, runs the
# vite dev server. Much faster than a full docker build — only the JS component
# is rebuilt.
#
# Two serving modes (server mode is the default):
#
#   ./dev.sh                 Server mode (Docker/local). Runs the taxonium_backend
#   ./dev.sh --server        server and vite reverse-proxies API calls to it — the
#                            classic build the Docker image ships.
#
#   ./dev.sh --wasm          Backendless/WASM mode. Builds with VITE_BACKENDLESS=1
#   ./dev.sh --backendless   so the whole pipeline runs in the browser (Pyodide +
#                            WASM); no backend server is started. Same build the
#                            static (Vercel) site serves.
#
# Single-origin: the app is reachable on ONE port (3000). In server mode the
# backend runs internally and vite reverse-proxies API calls to it, so there is no
# second port to expose and no host-port conflict. Change the host port freely:
#   PORT=8080 ./dev.sh              # open http://localhost:8080
#   PORT=8080 ./dev.sh --wasm
# BACKEND_PORT only sets the *internal* backend port (server mode; rarely changed).
set -e

usage() {
  # Print the header comment block (line 2 until the first non-comment line).
  awk 'NR>=2 && /^#/ { sub(/^# ?/, ""); print; next } NR>=2 { exit }' "$0"
  echo "Usage: [PORT=3000] [BACKEND_PORT=8001] ./dev.sh [--server | --wasm]"
}

PORT="${PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-8001}"

MODE=server
while [ $# -gt 0 ]; do
  case "$1" in
    --wasm|--backendless)       MODE=wasm ;;
    --server|--docker|--local)  MODE=server ;;
    -h|--help)                  usage; exit 0 ;;
    *) echo "dev.sh: unknown option '$1' (use --server, --wasm, or --help)" >&2; exit 1 ;;
  esac
  shift
done

# The inner scripts below print clear [n/N] stage banners and actively poll each
# server until it accepts connections (curl without -f, so a launcher-mode backend
# that answers /config with 500 still counts as "up"), then print a READY banner.
# $BACKEND_PORT and $HOST_PORT are expanded inside the container (passed via -e).
if [ "$MODE" = wasm ]; then
  echo "▶ WASM (backendless) mode — pipeline runs in the browser, no backend."
  ENV_ARGS=(-e VITE_BACKENDLESS=1)
  RUN_CMD='
    source /opt/conda/etc/profile.d/conda.sh && conda activate taxalin
    wait_for() { for _ in $(seq 1 "$2"); do curl -s -o /dev/null "$1" 2>/dev/null && return 0; sleep 0.5; done; return 1; }

    echo ""; echo "==> [1/2] Building component (dev build)..."
    ( cd /app/ui/taxonium_component && npm run build 2>&1 | tail -3 )

    echo "==> Backendless (WASM) mode: no backend to start — AutoLin runs in your browser."

    echo "==> [2/2] Starting frontend (vite)..."
    ( cd /app/ui && npx vite --port 3000 --host 0.0.0.0 ) &
    echo "==> ...waiting for the app to come up..."
    wait_for "http://localhost:3000/" 120 || echo "==> [WARN] app slow to start — see logs above."
    echo ""
    echo "===================================================================="
    echo "  READY  ->  Linolium (WASM) at  http://localhost:'"$PORT"'"
    echo "===================================================================="
    echo ""
    wait'
else
  echo "▶ Server (Docker/local) mode — taxonium_backend + vite proxy."
  ENV_ARGS=()
  RUN_CMD='
    source /opt/conda/etc/profile.d/conda.sh && conda activate taxalin
    wait_for() { for _ in $(seq 1 "$2"); do curl -s -o /dev/null "$1" 2>/dev/null && return 0; sleep 0.5; done; return 1; }

    echo ""; echo "==> [1/3] Building component (dev build)..."
    ( cd /app/ui/taxonium_component && npm run build 2>&1 | tail -3 )

    echo "==> [2/3] Starting backend (internal port $BACKEND_PORT)..."
    ( cd /app/ui/taxonium_backend && node server.js --port "$BACKEND_PORT" ) &
    echo "==> ...waiting for backend to accept connections..."
    if wait_for "http://localhost:$BACKEND_PORT/config" 120; then
      echo "==> [OK] backend is up."
    else
      echo "==> [WARN] backend not responding yet — starting frontend anyway (see logs above)."
    fi

    echo "==> [3/3] Starting frontend (vite)..."
    ( cd /app/ui && npx vite --port 3000 --host 0.0.0.0 ) &
    echo "==> ...waiting for the app to come up..."
    wait_for "http://localhost:3000/" 120 || echo "==> [WARN] app slow to start — see logs above."
    echo ""
    echo "===================================================================="
    echo "  READY  ->  Linolium at  http://localhost:'"$PORT"'"
    echo "===================================================================="
    echo ""
    wait'
fi

docker run -it --rm --memory=8g \
  -v "$PWD/ui/linolium/src":/app/ui/src \
  -v "$PWD/ui/linolium/worker":/app/ui/worker \
  -v "$PWD/ui/linolium/ts":/app/ui/ts \
  -v "$PWD/ui/linolium/public":/app/ui/public \
  -v "$PWD/ui/linolium/vite.config.js":/app/ui/vite.config.js \
  -v "$PWD/ui/linolium/taxonium_component/src":/app/ui/taxonium_component/src \
  -v "$PWD/ui/linolium/taxonium_backend":/app/ui/taxonium_backend \
  -v /app/ui/taxonium_backend/node_modules \
  -v "$PWD/autolin":/app/autolin \
  -v "$PWD":/data \
  -e BACKEND_PORT="$BACKEND_PORT" \
  "${ENV_ARGS[@]}" \
  -p "$PORT:3000" \
  linolium bash -c "$RUN_CMD"
