# Lineage Curation

Automated phylogenetic lineage proposal and interactive curation.

## Intallation

Build docker
```bash
docker build -t taxalin .
```

Run docker container
```bash
docker run -it -p 3000:3000 -p 8000:8000  -v "$PWD":/workspace -w /workspace taxalin
```

## Quick Start

**Input**: UShER MAT file (`.pb`)  
**Output**: Automated sub-lineage proposals (Autolin) and interactive curation interface

```bash
# Generate proposals
cd autolin
python propose_sublineages.py -i your_tree.pb -o your_tree.autolin.pb
python convert_autolinpb_totax.py -a your_tree.autolin.pb

# Launch interface  
cd ../ui/linolium
npm run install-all && npm run build
./run-prod.sh ../../autolin/your_tree.autolin.jsonl.gz
```

Open http://localhost:3000

## Docker Container (Recommended)
```bash
docker build -t lineage-curation .
docker run -p 3000:3000 -p 8001:8001 -v $(pwd):/data -it lineage-curation
```

## Test with Sample Data

```bash
cd autolin
python propose_sublineages.py -i mtb.4.8.pb -o mtb.4.8.autolin.pb
python convert_autolinpb_totax.py -a mtb.4.8.autolin.pb
cd ../ui/linolium
./run-prod.sh ../../autolin/mtb.4.8.autolin.jsonl.gz
```


## Components

- **[autolin/](autolin/)** - Autolin algorithm for lineage proposals
- **[ui/](ui/)** - Web interface for curation
- **[recombination-detection/](recombination-detection/)** - Recombination analysis
