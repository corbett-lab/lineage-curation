# Deploying the browserized Linolium to Vercel

The app is a fully static, backendless build (Route C + Pyodide AutoLin).
`npm run build` in `ui/linolium/` emits a self-contained `dist/` that any static
host can serve. These files wire that build to Vercel with auto-publish on every
push to `browserize-static`.

## What's here

| File | Repo location it goes to | Purpose |
|------|--------------------------|---------|
| `vercel.json` | `ui/linolium/vercel.json` | Build command, output dir, SPA rewrite (keeps `autolin-assets/`, `assets/`, and all extensioned static files un-rewritten) |
| `.vercelignore` | `ui/linolium/.vercelignore` | Trims the upload (drops the unused server backend, node_modules, sourcemaps, docker) |
| `workflows/deploy-vercel.yml` | `.github/workflows/deploy-vercel.yml` | GitHub Actions: production deploy on push to `browserize-static` |

Key build facts Vercel needs:
- **Root Directory:** `ui/linolium`
- **Build Command:** `npm run build` (runs build:component → build:data-handling → build:app)
- **Output Directory:** `dist`
- **Node version:** 20 or 22 (host default 12 is too old for Vite)
- **Memory:** the `taxonium_component` build sets `--max-old-space-size=8192`; Vercel's build container (8 GB) handles it. The Actions path raises Node to 12 GB to be safe on standard runners.

---

## Path A — Vercel Git integration (recommended, no workflow needed)

This is the "auto-publish built into GitHub" flow: Vercel installs a GitHub App,
watches the repo, and redeploys on every push. No secrets, no Actions YAML.

1. Commit `vercel.json` + `.vercelignore` into `ui/linolium/` on `browserize-static` (already staged locally — see below).
2. In the Vercel dashboard: **Add New → Project → Import** `corbett-lab/linolium`.
3. Set **Root Directory = `ui/linolium`**. Vercel auto-detects Vite; confirm Build Command `npm run build`, Output `dist`.
4. **Project Settings → Environments → Production → Branch Tracking:** set the production branch to **`browserize-static`** (not `main`).
5. Set **Node.js Version = 22** in Project Settings → General.
6. Deploy. Every subsequent push to `browserize-static` → production deploy; other branches → preview URLs.

You do **not** need the workflow file for this path. Delete it if you go this route.

---

## Path B — GitHub Actions + Vercel CLI (deploy logic lives in the repo)

Use this if you want the deploy defined in-repo rather than in Vercel's dashboard.

1. Create the Vercel project once (locally): `cd ui/linolium && npx vercel link`
   → this writes `ui/linolium/.vercel/project.json` with `orgId` + `projectId`.
2. Create a Vercel token: Vercel → Account Settings → Tokens.
3. Add three **repository secrets** (GitHub → Settings → Secrets and variables → Actions):
   - `VERCEL_TOKEN` — the token from step 2
   - `VERCEL_ORG_ID` — `orgId` from `.vercel/project.json`
   - `VERCEL_PROJECT_ID` — `projectId` from `.vercel/project.json`
4. Ensure the Vercel project's **Root Directory = `ui/linolium`** (Project Settings).
5. Commit `.github/workflows/deploy-vercel.yml`. Push to `browserize-static` → the workflow builds and deploys to production.

---

## Notes

- **Pyodide is loaded from the jsDelivr CDN** at runtime (`cdn.jsdelivr.net/pyodide/v0.27.2/full/`). No extra Vercel config needed; if you want it fully self-hosted, set `self.PYODIDE_INDEX_URL` in the worker and vendor the assets under `public/`.
- **`autolin-assets/`** (bte_shim.py, propose_sublineages.py, alias_key.json, pango_aliasor) and the sample tree `mtb.4.8.autolin.r.jsonl.gz` are served as static files — the SPA rewrite explicitly excludes them.
- The `.py`/`.wasm`/`.gz` assets are fetched by the workers; Vercel serves them with sensible content-types by extension. No rewrite touches them.
- Staying on `browserize-static` keeps `main` untouched, exactly as requested. To promote later, open a PR from `browserize-static` → `main` (Vercel will post a preview URL on the PR).
