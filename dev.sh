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

# Both modes compile the JS component first.
BUILD_COMPONENT='
  source /opt/conda/etc/profile.d/conda.sh && conda activate taxalin &&
  echo "Building component..." &&
  cd /app/ui/taxonium_component && npm run build 2>&1 | tail -3'

if [ "$MODE" = wasm ]; then
  echo "▶ WASM (backendless) mode — pipeline runs in the browser, no backend."
  echo "  Open http://localhost:$PORT"
  ENV_ARGS=(-e VITE_BACKENDLESS=1)
  RUN_CMD="$BUILD_COMPONENT &&
    cd /app/ui && npx vite --port 3000 --host 0.0.0.0"
else
  echo "▶ Server (Docker/local) mode — taxonium_backend + vite proxy."
  echo "  Open http://localhost:$PORT"
  ENV_ARGS=()
  RUN_CMD="$BUILD_COMPONENT &&
    cd /app/ui/taxonium_backend && node server.js --port \"\$BACKEND_PORT\" &
    sleep 2 &&
    cd /app/ui && npx vite --port 3000 --host 0.0.0.0 &
    wait"
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
