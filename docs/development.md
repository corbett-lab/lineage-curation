# Development

## Architecture

Linolium runs the **same pipeline** two ways, so results match whether or not there
is a backend:

| | Server mode | Backendless (WASM) mode |
|---|---|---|
| Runs | `./dev.sh` / the Docker image | the hosted site / `./dev.sh --wasm` |
| Pipeline | Express backend shells out to native `matUtils`, `usher_to_taxonium`, and `propose_sublineages.py` (conda) | the whole pipeline runs in the browser: Pyodide for AutoLin + JS ports of the native tools |
| Best for | very large trees | zero-install, hosted use |

The pipeline itself is: **AutoLin** proposes sublineages
(`src/autolin/propose_sublineages.py`) → the tree is **converted** to Taxonium format
→ the **viewer** displays it for interactive curation.

Three pieces are shared or guarded so the two modes can't diverge:

- **AutoLin algorithm** — a single `propose_sublineages.py`; the WASM copy is synced
  from it and a CI check (`check-autolin-sync`) fails on drift.
- **Lineage-edit engine** — `src/ui/shared/lineageEditCore.cjs` (merge / edit-root /
  conflict-aware undo) is imported by *both* the backend and the in-browser worker.
- **Conversion ports** — the JS ports in `src/ui/ts/src/` are verified byte-exact
  against native `matUtils`/`usher_to_taxonium` by CI (`check-conversion-parity`).

## Install from source

The recommended path is Docker (`./dev.sh`, no local setup). To build without it:

**Native pipeline (conda):**

```bash
conda env create -f env.yml
conda activate taxalin        # provides matUtils, usher_to_taxonium, bte, propose_sublineages deps
```

**Frontend + backend (Node ≥ 18):**

```bash
cd src/ui
npm run install-all           # installs the app, component, data-handling, and backend
npm run build                 # or: npm run dev   (Vite dev server)
```

See [`dev.sh`](https://github.com/corbett-lab/linolium/blob/main/dev.sh) for how the
backend and Vite are wired together in each mode.

## Running the tests

```bash
cd src/ui && npm test         # conversion parity + lineage-edit engine (pure Node)

# AutoLin proposal golden (needs the native env, so runs in the image):
docker run --rm -v "$PWD":/repo -w /repo ghcr.io/corbett-lab/linolium \
  bash src/autolin/test/run-autolin-golden.sh
```

## Worked example

The repository ships a small golden tree, `src/autolin/XFG.pangoonly.pb` (7,288
SARS-CoV-2 XFG samples). Running AutoLin on it with the default parameters is fully
reproducible:

```bash
docker run --rm -v "$PWD":/repo -w /repo ghcr.io/corbett-lab/linolium bash -lc '
  source /opt/conda/etc/profile.d/conda.sh && conda activate taxalin
  python src/autolin/propose_sublineages.py \
    -i src/autolin/XFG.pangoonly.pb -o /tmp/out.pb \
    -m 10 -t 1 -u 0.95 -f 0 -d /tmp/dump.tsv -l /tmp/labels.tsv
  head -3 /tmp/dump.tsv'
```

This proposes **130 sublineages**; the exact table is committed as the golden at
`src/autolin/test/golden/xfg.autolin.dump.tsv` and checked in CI. The first rows:

```
parent  parent_nid  proposed_sublineage  proposed_sublineage_nid  proposed_sublineage_score  proposed_sublineage_size
XFG     node_1      auto.XFG.20          node_21                  19.01388888888889          37
XFG.3   node_1938   auto.XFG.3.19        node_1939                4.651162790697675          20
```

To explore the result interactively, run the same tree through the app
(`./dev.sh`, then upload `XFG.pangoonly.pb`).
