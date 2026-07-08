# Contributing to Linolium

Thanks for your interest in improving Linolium! This guide covers how to set up a
development environment, run the tests, and submit changes. By contributing you
agree that your contributions are licensed under the project's [GPL-3.0](LICENSE)
license.

## Getting help / reporting problems

- **Bugs and feature requests:** open an [issue](https://github.com/corbett-lab/linolium/issues)
  using one of the templates. For bugs, please include the input (tree size/format),
  the steps you took, and what you expected vs. what happened.
- **Questions and usage help:** open a
  [discussion](https://github.com/corbett-lab/linolium/discussions) or an issue.
- Please search existing issues first to avoid duplicates.

## Repository layout

```
src/ui/          Frontend + backend (one npm project)
  src/             Vite app (upload, pipeline UI, viewer)
  taxonium_backend/  Express server (server mode)
  worker/          In-browser pipeline workers (WASM/backendless mode)
  ts/src/          JS ports of native tools (matpb, matUtils, usherToTaxonium)
  shared/          lineageEditCore.cjs — the shared lineage-edit engine
  ts/test/         JS tests (conversion parity, lineage-edit engine)
src/autolin/     AutoLin algorithm (propose_sublineages.py) + its golden test
paper/           JOSS manuscript
docs/            Documentation site (mkdocs-material)
```

Linolium runs in two modes that share the same logic (see the
[architecture docs](https://corbett-lab.github.io/linolium/)):

- **Server mode** — an Express backend shells out to native `matUtils` /
  `usher_to_taxonium` / `propose_sublineages.py` (Docker/conda).
- **Backendless (WASM) mode** — the whole pipeline runs in the browser (Pyodide +
  JS ports). This is what the hosted site serves.

## Development setup

You need Docker. The dev script mounts your source into the linolium image and runs
Vite with hot reload — no local conda/node setup required:

```bash
./dev.sh            # server mode  (http://localhost:3000)
./dev.sh --wasm     # backendless/WASM mode (same port)
./dev.sh --help     # options
```

To build the images/artifacts directly: `docker build -t linolium .` (server image)
or `./build_static.sh` (the static WASM site). The native pipeline's pinned conda
environment is [`env.yml`](env.yml).

## Running the tests

**JS tests** (pure Node, no install — the ports/engine have no dependencies):

```bash
cd src/ui && npm test
```

This runs the conversion-parity test (JS ports vs native `matUtils`/`usher_to_taxonium`
outputs, byte-exact against committed goldens) and the lineage-edit engine test
(merge / edit-root / conflict-aware undo).

**AutoLin proposal golden** (needs the native env, so it runs in the image):

```bash
docker run --rm -v "$PWD":/repo -w /repo ghcr.io/corbett-lab/linolium \
  bash src/autolin/test/run-autolin-golden.sh
```

CI runs all of these plus two sync guards (`check-autolin-sync`,
`check-conversion-parity`). If you intentionally change a port or the algorithm,
regenerate the relevant golden — each test's header explains how.

## Code style

We use [Prettier](https://prettier.io/) (config in [`.prettierrc.json`](.prettierrc.json)):

```bash
cd src/ui && npm run format        # write
cd src/ui && npm run format:check  # check only
```

Match the conventions of the surrounding code, and keep changes focused.

## Submitting a change

1. Fork and branch off `main`.
2. Make your change; add or update a test when you change behavior.
3. Run `npm test` (and the AutoLin golden if you touched `src/autolin/`).
4. Run the formatter.
5. Open a pull request against `main` describing the change and how you verified it.
   CI must pass before review.
