#!/usr/bin/env bash
# Runs propose_sublineages.py on a golden tree and checks the proposed sublineages
# (the -d dump) byte-exact against the committed golden. Needs the native env, so it
# runs in the linolium image (see .github/workflows/check-autolin-golden.yml).
#
# Regenerate after an intentional algorithm change (repo root, in the image):
#   docker run --rm -v "$PWD":/repo -w /repo ghcr.io/corbett-lab/linolium \
#     bash -lc 'source /opt/conda/etc/profile.d/conda.sh && conda activate taxalin && \
#       python src/autolin/propose_sublineages.py -i src/autolin/XFG.pangoonly.pb \
#       -o /tmp/o.pb -m 10 -t 1 -u 0.95 -f 0 \
#       -d src/autolin/test/golden/xfg.autolin.dump.tsv -l /tmp/labels.tsv'
set -euo pipefail

source /opt/conda/etc/profile.d/conda.sh && conda activate taxalin

HERE="$(cd "$(dirname "$0")" && pwd)"     # src/autolin/test
AUTOLIN_DIR="$(dirname "$HERE")"          # src/autolin
INPUT="$AUTOLIN_DIR/XFG.pangoonly.pb"
GOLDEN="$HERE/golden/xfg.autolin.dump.tsv"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Same defaults the server (server.js /run-autolin) and the WASM path use.
python "$AUTOLIN_DIR/propose_sublineages.py" \
  -i "$INPUT" -o "$TMP/out.pb" \
  -m 10 -t 1 -u 0.95 -f 0 \
  -d "$TMP/dump.tsv" -l "$TMP/labels.tsv" >/dev/null

if diff -u "$GOLDEN" "$TMP/dump.tsv"; then
  echo "✓ AutoLin proposal matches golden ($(wc -l < "$GOLDEN" | tr -d ' ') lines)"
else
  echo "" >&2
  echo "✗ AutoLin proposal differs from golden. If this change is intentional," >&2
  echo "  regenerate the golden (see the header of this script) and re-run." >&2
  exit 1
fi
