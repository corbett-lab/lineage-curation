# Lineage Curation UI

Interactive web interface for phylogenetic lineage curation and analysis.

## Quick Start

### 1. Install Dependencies
```bash
cd linolium
npm run install-all
```

### 2. Build Components
```bash
npm run build
```

### 3. Run with Custom Data
```bash
# Use the provided script with your Taxonium-format JSONL file
./run-prod.sh /path/to/your/data.jsonl.gz

# Or manually:
# Terminal 1 - Backend
cd taxonium_backend
node server.js --port 8001 --data_file /path/to/your/data.jsonl.gz

# Terminal 2 - Frontend  
cd ..
npm run serve
```

### 4. Access the Interface
- **Frontend**: http://localhost:3000
- **Backend API (for developers)**: http://localhost:8001
