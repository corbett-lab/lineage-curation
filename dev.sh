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

# Warn if something already holds the host port before Docker binds it. The usual
# culprit is VS Code's port forwarding squatting on IPv4 127.0.0.1:$PORT; Docker
# then only gets IPv6, so the app loads in Chrome (which uses IPv6 for localhost)
# but hangs in Firefox (which uses IPv4). We can only flag it, not free it.
warn_if_port_busy() {
  command -v lsof >/dev/null 2>&1 || return 0
  local listeners
  listeners=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tail -n +2)
  [ -z "$listeners" ] && return 0
  echo "⚠️  Port $PORT already has a listener before Docker starts:"
  echo "$listeners" | sed 's/^/      /'
  echo "    If that is a non-Docker process on IPv4 (e.g. VS Code port forwarding),"
  echo "    the app will load in Chrome (IPv6 localhost) but hang in Firefox (IPv4)."
  echo "    Fix: free it (VS Code Ports panel -> Stop Forwarding Port), pick another"
  echo "    PORT, or open http://[::1]:$PORT in Firefox."
  echo ""
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

warn_if_port_busy

docker run -it --rm --memory=8g \
  -v "$PWD/src/ui/src":/app/ui/src \
  -v "$PWD/src/ui/worker":/app/ui/worker \
  -v "$PWD/src/ui/ts":/app/ui/ts \
  -v "$PWD/src/ui/public":/app/ui/public \
  -v "$PWD/src/ui/vite.config.js":/app/ui/vite.config.js \
  -v "$PWD/src/ui/taxonium_component/src":/app/ui/taxonium_component/src \
  -v "$PWD/src/ui/taxonium_backend":/app/ui/taxonium_backend \
  -v /app/ui/taxonium_backend/node_modules \
  -v "$PWD/src/autolin":/app/autolin \
  -v "$PWD":/data \
  -e BACKEND_PORT="$BACKEND_PORT" \
  -e HMR_CLIENT_PORT="$PORT" \
  "${ENV_ARGS[@]}" \
  -p "$PORT:3000" \
  linolium bash -c "$RUN_CMD"
