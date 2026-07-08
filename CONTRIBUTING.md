# Contributing

Contributions are welcome, under the [GPL-3.0](LICENSE) license.

- **Bugs / features:** open an [issue](https://github.com/corbett-lab/linolium/issues).
  For bugs, include the input tree (format and rough size), what you did, and what
  you expected.
- **Questions:** use [Discussions](https://github.com/corbett-lab/linolium/discussions).

## Layout

```
src/ui/          frontend + Express backend (one npm project)
  ts/src/          JS ports of the native tools (matpb, matUtils, usherToTaxonium)
  shared/          lineageEditCore.cjs — shared lineage-edit engine
  ts/test/         JS tests
src/autolin/     AutoLin (propose_sublineages.py) + its golden test
docs/            mkdocs site
paper/           JOSS manuscript
```

Linolium runs in two modes that share this logic — a **server** mode (the backend
calls native `matUtils` / `usher_to_taxonium` / `propose_sublineages.py`) and a
**backendless** mode (the same pipeline in the browser). See the
[architecture notes](https://corbett-lab.github.io/linolium/development/).

## Setup

You need Docker. `dev.sh` mounts your source into the image and runs Vite with reload:

```bash
./dev.sh          # server mode, http://localhost:3000
./dev.sh --wasm   # backendless mode
```

Without Docker: `conda env create -f env.yml` for the native pipeline, then
`cd src/ui && npm run install-all && npm run build`.

## Tests

```bash
cd src/ui && npm test    # conversion parity + lineage-edit engine

# AutoLin golden (needs the native env):
docker run --rm -v "$PWD":/repo -w /repo ghcr.io/corbett-lab/linolium \
  bash src/autolin/test/run-autolin-golden.sh
```

If you change a port or the algorithm, regenerate the affected golden — each test's
header says how. Format with `npm run format`.

## Pull requests

Branch off `main`, add a test for any behavior change, check that `npm test` and the
formatter pass, and describe what you changed and how you verified it.
