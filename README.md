# Lineage Curation

## Installation

Build the Docker image:
```bash
docker build -t taxalin .
```
```bash
docker run -it taxalin
```
**Docker container has been successfully built and run in a Linux server running Ubuntu 22.04.5 LTS (GNU/Linux 5.15.0-153-generic x86_64)**
## Quick start

A test UShER MAT subtree is included in the `data` directory. It contains a clade extracted from a [M. tuberculosis ](https://hgdownload.gi.ucsc.edu/hubs/GCF/000/195/955/GCF_000195955.2/UShER_Mtb_SRA/) MAT rooted at `node_15206`.
```bash
matUtils extract -i mtb.20240912.mask10.pb -I node_15206 -o subtree.pb
```

To run:

```bash
cd autolin
python propose_sublineages.py -i ../data/subtree.pb -d lineages.txt
```
This will output proposed lineage to `lineages.txt`.