# Development

## Architecture

Linolium runs the same pipeline two ways:

| | Server mode | Backendless mode |
|---|---|---|
| Where | `./dev.sh` / the Docker image | the hosted site / `./dev.sh --wasm` |
| Pipeline | the backend calls native `matUtils`, `usher_to_taxonium`, `propose_sublineages.py` | it all runs in the browser (Pyodide + JS ports of those tools) |
| Use for | very large trees | zero-install |

The pipeline: AutoLin proposes sublineages (`src/autolin/propose_sublineages.py`), the
tree is converted to Taxonium format, and the viewer displays it for curation.

Three pieces keep the two modes equivalent:

- `propose_sublineages.py` is synced into the WASM assets, with a CI check on drift.
- The lineage-edit engine (`src/ui/shared/lineageEditCore.cjs`) is imported by both.
- The JS conversion ports (`src/ui/ts/src/`) are tested byte-exact against the native tools.

## Building from source

Docker (`./dev.sh`) is the easy path. Without it:

```bash
conda env create -f env.yml && conda activate taxalin   # native pipeline (matUtils, bte, ...)
cd src/ui && npm run install-all && npm run build        # frontend + backend
```

## Tests

```bash
cd src/ui && npm test    # conversion parity + lineage-edit engine

# AutoLin golden (needs the native env):
docker run --rm -v "$PWD":/repo -w /repo ghcr.io/corbett-lab/linolium \
  bash src/autolin/test/run-autolin-golden.sh
```

## Worked example

`src/autolin/XFG.pangoonly.pb` is a 7,288-sample SARS-CoV-2 XFG tree. Running AutoLin
on it with the defaults is deterministic:

```bash
docker run --rm -v "$PWD":/repo -w /repo ghcr.io/corbett-lab/linolium bash -lc '
  source /opt/conda/etc/profile.d/conda.sh && conda activate taxalin
  python src/autolin/propose_sublineages.py -i src/autolin/XFG.pangoonly.pb \
    -o /tmp/out.pb -m 10 -t 1 -u 0.95 -f 0 -d /tmp/dump.tsv -l /tmp/labels.tsv
  head -3 /tmp/dump.tsv'
```

It proposes 130 sublineages; the full table is committed as the golden at
`src/autolin/test/golden/xfg.autolin.dump.tsv`. Upload the same file to the app
(`./dev.sh`) to explore the result interactively.
