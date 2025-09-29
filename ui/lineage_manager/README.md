# Lineage Manager

An advanced phylogenetic lineage analysis and curation tool built with React and TypeScript.

## Features

- **Direct JSONL Processing**: Processes complete phylogenetic datasets without subsampling limitations
- **Gzip Decompression**: Client-side decompression of .jsonl.gz files using pako
- **Parsimony Analysis**: Robust lineage tree construction with conflict detection
- **Interactive Dashboard**: Comprehensive analysis interface with collapsible sections
- **Multiple Lineage Types**: Support for Pango lineages, Nextstrain clades, WHO names, and custom lineages
- **Real-time Visualization**: Integration with Taxonium for phylogenetic tree visualization

## Project Structure

```
src/
├── types.ts                     # TypeScript interfaces and type definitions
├── RobustLineageTree.ts        # Core analysis engine for parsimony inference
├── components/
│   ├── UIComponents.tsx        # Reusable UI components (CollapsibleSection, DataTable, StatCard)
│   └── LineageParsimonyPanel.tsx # Main dashboard component
├── LineageManager.tsx          # Main application component
├── main.tsx                   # Application entry point
└── index.css                  # Global styles
```

## Installation

```bash
npm install
```

## Development

Start the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview production build:

```bash
npm run preview
```

## Usage

The Lineage Manager automatically loads and processes phylogenetic data from JSONL files. It provides:

1. **Complete Dataset Analysis**: Processes all nodes without subsampling
2. **Lineage Hierarchy Visualization**: Shows parent-child relationships in lineage assignments
3. **Conflict Detection**: Identifies inconsistencies in lineage annotations
4. **Statistical Analysis**: Provides comprehensive metrics on lineage distributions
5. **Interactive Exploration**: Allows switching between different lineage classification systems

## Configuration

The default data source is configured to load from:
```
https://cov2tree.nyc3.cdn.digitaloceanspaces.com/tfci-taxonium.jsonl.gz
```

This can be customized by passing a different `dataUrl` prop to the `LineageManager` component.

## Dependencies

- **React**: Modern UI framework
- **TypeScript**: Type-safe development
- **Vite**: Fast build tooling
- **pako**: Client-side gzip decompression
- **taxonium-component**: Phylogenetic tree visualization

## Architecture

The application is built around the `RobustLineageTree` class, which:
- Ingests phylogenetic node data from JSONL files
- Constructs lineage hierarchies using parsimony inference
- Detects conflicts and inconsistencies in lineage assignments
- Provides statistical analysis of lineage distributions

The UI is modular, with reusable components for data visualization and a comprehensive dashboard for exploring the analysis results.
