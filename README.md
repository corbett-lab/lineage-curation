<p align="center">
  <img src="docs/img/title.png" alt="Linolium" width="220">
</p>

Automated phylogenetic lineage proposal and interactive curation.

Linolium provides an environment for lineage discovery and curation on pathogen phylogenetic trees of virtually any size. It builds on the AutoLin algorithm for distance-based identification of clades and provides a UI for customizing the algorithm and curating results.

Use the web app:

➜ [linolium.vercel.app](https://linolium.vercel.app/)

or run the Docker container locally for larger trees.

## Quick Start (local)

```bash
docker run -it --memory=8g -v "$PWD":/data -p 3000:3000 ghcr.io/corbett-lab/linolium
```

Open [http://localhost:3000](http://localhost:3000), upload a `.pb` or `.pb.gz` file, and run the pipeline.

> The app runs on a single port. If `3000` is taken on your machine, remap it —
> e.g. `-p 8080:3000`, then open [http://localhost:8080](http://localhost:8080).

📖 **See the [Linolium documentation](https://corbett-lab.github.io/linolium/) for detailed usage instructions.**
