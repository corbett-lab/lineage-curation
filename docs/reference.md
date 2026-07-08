# Command-line reference

The pipeline can be scripted instead of run through the UI. The core step is
`propose_sublineages.py` (the AutoLin algorithm); it reads a UShER MAT and writes the
proposed lineages. Run it in the image with the repo mounted:

```bash
docker run --rm -v "$PWD":/data -w /data ghcr.io/corbett-lab/linolium bash -lc '
  source /opt/conda/etc/profile.d/conda.sh && conda activate taxalin
  python /app/autolin/propose_sublineages.py -i tree.pb -o annotated.pb \
    -d proposed.tsv -l labels.tsv'
```

The app runs it with `-m 10 -t 1 -u 0.95 -f 0 -d … -l …` (plus `-r` when Recursive is on).

## Options

**Input / output**

| Flag | Description |
|------|-------------|
| `-i`, `--input` | UShER MAT protobuf to annotate (required) |
| `-o`, `--output` | Write the annotated protobuf here |
| `-d`, `--dump` | Write the proposed sublineages as a table |
| `-l`, `--labels` | Write lineage↔sample associations (formatted for `matUtils annotate -c`) |
| `-v`, `--verbose` | Print progress |

**Lineage criteria**

| Flag | Default | Description |
|------|---------|-------------|
| `-m`, `--minsamples` | 10 | Minimum sample weight for a proposed lineage |
| `-t`, `--distinction` | 1 | Minimum mutations distinguishing a lineage from its parent |
| `-u`, `--cutoff` | 0.95 | Stop adding serial lineages once this fraction of samples is covered |
| `-f`, `--floor` | 0 | Minimum score to report a lineage |
| `-r`, `--recursive` | off | Recursively propose sublineages within proposals |
| `-c`, `--clear` | off | Clear existing annotations before starting |

**Scope**

| Flag | Description |
|------|-------------|
| `-a`, `--annotation` | Propose only within this lineage and its sublineages |
| `-p`, `--samples` | Restrict to samples in this file (`sample weight` per line) |

**Weighting and translation** (advanced)

| Flag | Description |
|------|-------------|
| `-w`, `--mutweights` | Per-mutation weights file (2–3 columns: mutation, weight, [node]) |
| `-y`, `--aaweights` | Per-amino-acid-change weights; requires `--gtf` and `--reference` |
| `-g`, `--gene` | Consider only mutations in this gene; requires `--gtf` and `--reference` |
| `-s`, `--missense` | Consider only missense mutations; requires `--gtf` and `--reference` |
| `--gtf` | GTF for translation (use with `--reference`) |
| `--reference` | Reference FASTA for translation (use with `--gtf`) |

## Formats

**Input** — a [UShER](https://usher-wiki.readthedocs.io/) Mutation Annotated Tree
protobuf (`.pb` or `.pb.gz`).

**Outputs**

| File | Contents |
|------|----------|
| `-o` protobuf | the tree with proposed `auto.*` lineages annotated |
| `-d` table | one row per proposed lineage (parent, node id, score, size) |
| `-l` table | sample-to-lineage assignments |

The app additionally produces the Taxonium display file (`.jsonl.gz`), an annotated
`.pb.gz` (re-uploadable for further curation), and a sample-to-lineage `.tsv`.
