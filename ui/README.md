# Lineage Curation UI

Web interface for phylogenetic lineage curation.

## Quick Start

**Prerequisites**: JSONL file (`.jsonl.gz`) - see [main README](../#quick-start) for MAT conversion.

```bash
cd linolium
npm run install-all && npm run build
./run-prod.sh /path/to/your/data.jsonl.gz
```

Open http://localhost:3000

## Manual Launch

```bash
cd linolium
# Backend
cd taxonium_backend
node server.js --port 8001 --data_file /path/to/data.jsonl.gz

# Frontend (separate terminal)
cd ..
npm run serve
```

## Development

```bash
cd linolium
npm run dev-with-backend    # Hot reload
npm run rebuild-component   # Rebuild after changes
npm run clean              # Clean artifacts
```

## Structure

```
ui/
└── linolium/                   # Main application
    ├── taxonium_component/     # React components  
    ├── taxonium_backend/       # API server
    ├── taxonium_data_handling/ # Data utilities
    └── run-prod.sh            # Launch script
```

## Features

- Hierarchical lineage visualization
- Review proposed lineages (from Autolin)
- Real-time editing (merge, split, reassign)
- JSONL/TSV export