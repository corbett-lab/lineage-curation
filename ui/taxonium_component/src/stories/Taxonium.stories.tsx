import { useState, useEffect } from "react";
import type { Meta, StoryObj } from '@storybook/react';
import * as pako from 'pako';
import Taxonium from "../Taxonium";

interface TreeNode {
  id: number;  // Changed from nodeId to id for consistency
  parentId: number | null;
  isLeaf: boolean;
  sampleLineages: Map<string, string>; // sample-level annotations
  cladeLineages: Map<string, string>;  // clade-level annotations
  inferredLineages: Map<string, string>; // parsimony-inferred
  children: Set<number>;
  conflicts: Array<{ type: string; sample: string; expected: string; source: string }>;
}

const meta: Meta<typeof Taxonium> = {
  title: "Example/LineageManager",
  component: Taxonium,
  decorators: [(Story) => <div style={{ width: "100%", height: "600px", display: "flex" }}><Story /></div>],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Enhanced lineage node with confidence and source tracking
interface LineageNode {
  name: string;
  parent: string | null;
  children: Set<string>;
  depth: number;
  sampleCount: number;      // samples directly assigned this lineage
  cladeCount: number;       // clades annotated with this lineage  
  inferredCount: number;    // nodes where this was inferred via parsimony
  conflictCount: number;    // nodes with conflicting annotations
  confidence: number;       // 0-1 based on consistency
}

class RobustLineageTree {
  private nodes = new Map<number, TreeNode>();
  private parsimonyTrees = new Map<string, Map<string, LineageNode>>();
  private stats = { processed: 0, conflicts: 0, missing: 0 };

  addNode(id: number, parentId: number | null, details: any): void {
    const node: TreeNode = {
      id, parentId,
      isLeaf: !details.children || details.children.length === 0,
      sampleLineages: new Map(),
      cladeLineages: new Map(),  
      inferredLineages: new Map(),
      children: new Set(),
      conflicts: []
    };

    // Extract clade-level annotations (internal nodes)
    if (details.clades) {
      Object.entries(details.clades).forEach(([type, name]) => {
        if (typeof name === 'string' && name.trim()) {
          node.cladeLineages.set(type, name);
        }
      });
    }

    // Extract sample-level annotations (metadata, usually tips)
    Object.entries(details).forEach(([key, value]) => {
      if (key.startsWith('meta_') && key.includes('lineage') && typeof value === 'string' && value.trim()) {
        const type = key.replace('meta_', '');
        node.sampleLineages.set(type, value);
        
        // Check for conflicts with clade annotation
        const cladeLineage = node.cladeLineages.get(type);
        if (cladeLineage && cladeLineage !== value) {
          node.conflicts.push({
            type,
            sample: value,
            expected: cladeLineage,
            source: node.isLeaf ? 'sample-clade_mismatch' : 'internal-meta_conflict'
          });
          this.stats.conflicts++;
        }
      }
    });

    this.nodes.set(id, node);
    if (parentId && this.nodes.has(parentId)) this.nodes.get(parentId)!.children.add(id);
    
    this.stats.processed++;
    if (node.sampleLineages.size === 0 && node.cladeLineages.size === 0) this.stats.missing++;

    // Infer missing lineages via parsimony
    this.inferMissingLineages(node);
    this.updateParsimonyTrees(node);
  }

  private inferMissingLineages(node: TreeNode): void {
    // For each lineage type, if missing, infer from phylogenetic context
    const allTypes = new Set([
      ...Array.from(node.sampleLineages.keys()),
      ...Array.from(node.cladeLineages.keys())
    ]);
    
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId);
      if (parent) {
        parent.sampleLineages.forEach((_, type) => allTypes.add(type));
        parent.cladeLineages.forEach((_, type) => allTypes.add(type));
      }
    }

    allTypes.forEach(type => {
      const sampleLineage = node.sampleLineages.get(type);
      const cladeLineage = node.cladeLineages.get(type);
      
      if (!sampleLineage && !cladeLineage) {
        // Missing annotation - infer from ancestors
        const inferred = this.inferFromAncestors(node.id, type);
        if (inferred) {
          node.inferredLineages.set(type, inferred);
        }
      }
    });
  }

  private inferFromAncestors(nodeId: number, lineageType: string): string | null {
    let currentNode: TreeNode | undefined = this.nodes.get(nodeId);
    
    while (currentNode?.parentId) {
      currentNode = this.nodes.get(currentNode.parentId);
      if (currentNode) {
        const lineage = currentNode.cladeLineages.get(lineageType) || 
                       currentNode.sampleLineages.get(lineageType);
        if (lineage) return lineage;
      }
    }
    return null;
  }

  private updateParsimonyTrees(node: TreeNode): void {
    // Process all lineage sources
    const allLineages = new Map<string, { lineage: string; source: 'sample' | 'clade' | 'inferred' }>();
    
    node.sampleLineages.forEach((lineage, type) => allLineages.set(type, { lineage, source: 'sample' }));
    node.cladeLineages.forEach((lineage, type) => allLineages.set(type, { lineage, source: 'clade' }));
    node.inferredLineages.forEach((lineage, type) => allLineages.set(type, { lineage, source: 'inferred' }));

    allLineages.forEach(({ lineage, source }, type) => {
      if (!this.parsimonyTrees.has(type)) {
        this.parsimonyTrees.set(type, new Map());
      }
      
      const tree = this.parsimonyTrees.get(type)!;
      
      if (!tree.has(lineage)) {
        tree.set(lineage, {
          name: lineage,
          parent: null,
          children: new Set(),
          depth: 0,
          sampleCount: 0,
          cladeCount: 0,
          inferredCount: 0,
          conflictCount: node.conflicts.filter(c => c.type === type).length,
          confidence: 1.0
        });
      }

      const lineageNode = tree.get(lineage)!;
      if (source === 'sample') lineageNode.sampleCount++;
      else if (source === 'clade') lineageNode.cladeCount++;  
      else lineageNode.inferredCount++;

      // Find phylogenetic parent lineage
      if (node.parentId) {
        let currentNode: TreeNode | undefined = this.nodes.get(node.parentId);
        while (currentNode) {
          const parentLineage = currentNode.cladeLineages.get(type) || 
                               currentNode.sampleLineages.get(type) ||
                               currentNode.inferredLineages.get(type);
          
          if (parentLineage && parentLineage !== lineage) {
            if (!tree.has(parentLineage)) {
              tree.set(parentLineage, {
                name: parentLineage,
                parent: null,
                children: new Set(),
                depth: 0,
                sampleCount: 0,
                cladeCount: 0,
                inferredCount: 0,
                conflictCount: 0,
                confidence: 1.0
              });
            }
            
            const parentNode = tree.get(parentLineage)!;
            if (lineageNode.parent !== parentLineage) {
              if (lineageNode.parent) {
                tree.get(lineageNode.parent)?.children.delete(lineage);
              }
              lineageNode.parent = parentLineage;
              parentNode.children.add(lineage);
              lineageNode.depth = parentNode.depth + 1;
            }
            break;
          }
          currentNode = currentNode.parentId ? this.nodes.get(currentNode.parentId) : undefined;
        }
      }
      
      // Update confidence based on conflicts
      const totalCount = lineageNode.sampleCount + lineageNode.cladeCount + lineageNode.inferredCount;
      lineageNode.confidence = totalCount > 0 ? 
        1.0 - (lineageNode.conflictCount / totalCount) : 0.0;
    });
  }

  getParsimonyTree(lineageType: string): LineageNode[] {
    const tree = this.parsimonyTrees.get(lineageType);
    if (!tree) return [];
    
    return Array.from(tree.values())
      .filter(node => node.sampleCount + node.cladeCount + node.inferredCount > 0)
      .sort((a, b) => a.depth - b.depth || b.sampleCount - a.sampleCount);
  }

  analyze(): void {
    console.log(`=== ROBUST LINEAGE ANALYSIS ===`);
    console.log(`Processed: ${this.stats.processed}, Conflicts: ${this.stats.conflicts}, Missing: ${this.stats.missing}`);
    
    this.parsimonyTrees.forEach((tree, type) => {
      console.log(`\n${type.toUpperCase()} PARSIMONY TREE:`);
      const nodes = this.getParsimonyTree(type).slice(0, 15);
      nodes.forEach(node => {
        const indent = '  '.repeat(node.depth);
        const conf = (node.confidence * 100).toFixed(0);
        const counts = `S:${node.sampleCount} C:${node.cladeCount} I:${node.inferredCount}`;
        console.log(`${indent}${node.name} (${counts}) [${conf}% conf]`);
      });
    });
  }

  getStats() { return this.stats; }

  getAllLineageTypes(): string[] {
    return Array.from(this.parsimonyTrees.keys()).sort();
  }

  getConflicts(): Array<{ nodeId: number; type: string; sample: string; expected: string; source: string }> {
    const conflicts: Array<{ nodeId: number; type: string; sample: string; expected: string; source: string }> = [];
    this.nodes.forEach((node) => {
      node.conflicts.forEach((conflict) => {
        conflicts.push({ nodeId: node.id, ...conflict });
      });
    });
    return conflicts.sort((a, b) => a.nodeId - b.nodeId);
  }

  getLineageDistribution(lineageType: string): Array<{ name: string; total: number; sample: number; clade: number; inferred: number; conflicts: number; confidence: number }> {
    const tree = this.parsimonyTrees.get(lineageType);
    if (!tree) return [];
    
    return Array.from(tree.values())
      .filter(node => node.sampleCount + node.cladeCount + node.inferredCount > 0)
      .map(node => ({
        name: node.name,
        total: node.sampleCount + node.cladeCount + node.inferredCount,
        sample: node.sampleCount,
        clade: node.cladeCount,
        inferred: node.inferredCount,
        conflicts: node.conflictCount,
        confidence: node.confidence
      }))
      .sort((a, b) => b.total - a.total);
  }

  getTopConflictLineages(lineageType: string, limit = 10): Array<{ name: string; conflictRate: number; total: number; conflicts: number }> {
    return this.getLineageDistribution(lineageType)
      .filter(l => l.conflicts > 0)
      .map(l => ({
        name: l.name,
        conflictRate: l.conflicts / l.total,
        total: l.total,
        conflicts: l.conflicts
      }))
      .sort((a, b) => b.conflictRate - a.conflictRate)
      .slice(0, limit);
  }
}

const CollapsibleSection = ({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div style={{ marginBottom: '8px', border: '1px solid #dee2e6', borderRadius: '4px', overflow: 'hidden' }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '8px 12px',
          backgroundColor: '#f8f9fa',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: isOpen ? '1px solid #dee2e6' : 'none',
          fontSize: '12px',
          fontWeight: 'bold'
        }}
      >
        <span>{title}</span>
        <span style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
      </div>
      {isOpen && (
        <div style={{ padding: '12px', fontSize: '11px', lineHeight: '1.4' }}>
          {children}
        </div>
      )}
    </div>
  );
};

const DataTable = ({ data, columns }: { data: any[]; columns: Array<{ key: string; label: string; width?: string }> }) => {
  if (data.length === 0) return <div style={{ color: '#6c757d', fontStyle: 'italic' }}>No data available</div>;
  
  return (
    <div style={{ overflowX: 'auto', border: '1px solid #dee2e6', borderRadius: '3px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
        <thead>
          <tr style={{ backgroundColor: '#e9ecef' }}>
            {columns.map((col) => (
              <th key={col.key} style={{ 
                padding: '6px 8px', 
                textAlign: 'left', 
                fontWeight: 'bold',
                width: col.width || 'auto',
                borderBottom: '1px solid #dee2e6'
              }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 50).map((row, i) => (
            <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#f8f9fa' : 'white' }}>
              {columns.map((col) => (
                <td key={col.key} style={{ 
                  padding: '4px 8px', 
                  borderBottom: '1px solid #f1f3f4',
                  wordBreak: 'break-word'
                }}>
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > 50 && (
        <div style={{ padding: '4px 8px', backgroundColor: '#f8f9fa', fontSize: '9px', color: '#6c757d', textAlign: 'center' }}>
          Showing first 50 of {data.length} rows
        </div>
      )}
    </div>
  );
};

const StatCard = ({ title, value, subtitle, color = '#007bff' }: { title: string; value: string | number; subtitle?: string; color?: string }) => (
  <div style={{
    backgroundColor: 'white',
    border: `2px solid ${color}`,
    borderRadius: '6px',
    padding: '8px',
    textAlign: 'center',
    minWidth: '80px'
  }}>
    <div style={{ fontSize: '16px', fontWeight: 'bold', color }}>{value}</div>
    <div style={{ fontSize: '9px', color: '#6c757d', marginTop: '2px' }}>{title}</div>
    {subtitle && <div style={{ fontSize: '8px', color: '#6c757d' }}>{subtitle}</div>}
  </div>
);

const LineageParsimonyPanel = ({ tree, selectedType }: { tree: RobustLineageTree; selectedType: string }) => {
  const parsimonyTree = tree.getParsimonyTree(selectedType);
  const stats = tree.getStats();
  const distribution = tree.getLineageDistribution(selectedType);
  const conflicts = tree.getConflicts().filter(c => c.type === selectedType);
  const topConflicts = tree.getTopConflictLineages(selectedType, 10);
  const allTypes = tree.getAllLineageTypes();
  
  return (
    <div style={{
      width: '450px',
      height: '100%',
      backgroundColor: '#f8f9fa',
      borderRight: '1px solid #dee2e6',
      overflow: 'auto',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      {/* Header */}
      <div style={{ 
        padding: '12px', 
        backgroundColor: '#343a40', 
        color: 'white',
        position: 'sticky',
        top: 0,
        zIndex: 10
      }}>
        <h3 style={{ margin: '0', fontSize: '14px', fontWeight: 'bold' }}>
          📊 Lineage Analysis Dashboard
        </h3>
        <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '4px' }}>
          Active Type: {selectedType} | {stats.processed.toLocaleString()} nodes
        </div>
      </div>

      <div style={{ padding: '12px' }}>
        {/* Quick Stats Cards */}
        <CollapsibleSection title="📈 Overview Statistics" defaultOpen={true}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '12px' }}>
            <StatCard title="Total Nodes" value={stats.processed.toLocaleString()} color="#28a745" />
            <StatCard title="Conflicts" value={stats.conflicts.toLocaleString()} color="#dc3545" />
            <StatCard title="Missing Data" value={stats.missing.toLocaleString()} color="#ffc107" />
            <StatCard 
              title="Conflict Rate" 
              value={`${stats.processed > 0 ? ((stats.conflicts / stats.processed) * 100).toFixed(1) : '0'}%`} 
              color="#17a2b8" 
            />
          </div>
          
          <div style={{ marginBottom: '8px' }}>
            <strong>Available Types:</strong> {allTypes.length > 0 ? allTypes.join(', ') : 'Loading...'}
          </div>
        </CollapsibleSection>

        {/* Lineage Distribution */}
        {distribution.length > 0 && (
          <CollapsibleSection title={`🏷️ ${selectedType} Distribution (${distribution.length} unique)`}>
            <DataTable 
              data={distribution.slice(0, 20)}
              columns={[
                { key: 'name', label: 'Lineage', width: '40%' },
                { key: 'total', label: 'Total', width: '15%' },
                { key: 'sample', label: 'Sample', width: '15%' },
                { key: 'clade', label: 'Clade', width: '15%' },
                { key: 'inferred', label: 'Inferred', width: '15%' },
              ]}
            />
          </CollapsibleSection>
        )}

        {/* Conflict Analysis */}
        {topConflicts.length > 0 && (
          <CollapsibleSection title={`⚠️ High Conflict Lineages (${topConflicts.length})`}>
            <DataTable 
              data={topConflicts.map(item => ({
                name: item.name,
                conflictRate: `${(item.conflictRate * 100).toFixed(1)}%`,
                conflicts: item.conflicts,
                total: item.total,
                ratio: `${item.conflicts}/${item.total}`
              }))}
              columns={[
                { key: 'name', label: 'Lineage', width: '35%' },
                { key: 'conflictRate', label: 'Rate', width: '20%' },
                { key: 'ratio', label: 'Conflicts', width: '25%' },
                { key: 'total', label: 'Total', width: '20%' },
              ]}
            />
          </CollapsibleSection>
        )}

        {/* Recent Conflicts */}
        {conflicts.length > 0 && (
          <CollapsibleSection title={`🔴 Recent Conflicts (${conflicts.length} total)`}>
            <DataTable 
              data={conflicts.slice(-10).map(conflict => ({
                nodeId: conflict.nodeId,
                sample: conflict.sample,
                expected: conflict.expected,
                source: conflict.source
              }))}
              columns={[
                { key: 'nodeId', label: 'Node', width: '15%' },
                { key: 'sample', label: 'Sample', width: '25%' },
                { key: 'expected', label: 'Expected', width: '25%' },
                { key: 'source', label: 'Source', width: '35%' },
              ]}
            />
          </CollapsibleSection>
        )}

        {/* Parsimony Tree */}
        {parsimonyTree.length > 0 && (
          <CollapsibleSection title={`🌳 Parsimony Tree (${parsimonyTree.length} nodes)`}>
            <div style={{ fontSize: '9px', color: '#6c757d', marginBottom: '8px' }}>
              Colors: <span style={{ color: '#28a745' }}>High Confidence (&gt;90%)</span>, 
              <span style={{ color: '#fd7e14' }}> Medium (70-90%)</span>, 
              <span style={{ color: '#e74c3c' }}> Low (&lt;70%)</span>
            </div>
            <div style={{ 
              maxHeight: '300px', 
              overflow: 'auto', 
              border: '1px solid #dee2e6', 
              borderRadius: '3px',
              backgroundColor: 'white',
              padding: '8px'
            }}>
              {parsimonyTree.slice(0, 30).map((node: LineageNode, i: number) => (
                <div key={i} style={{
                  paddingLeft: `${node.depth * 12}px`,
                  marginBottom: '3px',
                  padding: '2px 4px',
                  backgroundColor: i % 2 === 0 ? '#f8f9fa' : 'transparent',
                  borderRadius: '2px'
                }}>
                  <span style={{ 
                    fontWeight: node.children.size > 0 ? 'bold' : 'normal',
                    color: node.confidence > 0.9 ? '#28a745' : 
                           node.confidence > 0.7 ? '#fd7e14' : '#e74c3c'
                  }}>
                    {node.name}
                  </span>
                  <span style={{ color: '#6c757d', fontSize: '9px', marginLeft: '4px' }}>
                    S:{node.sampleCount} C:{node.cladeCount} I:{node.inferredCount}
                  </span>
                  {node.conflictCount > 0 && (
                    <span style={{ color: '#dc3545', fontSize: '9px' }}>
                      {' '}⚠{node.conflictCount}
                    </span>
                  )}
                  <span style={{ color: '#17a2b8', fontSize: '9px' }}>
                    {' '}({Math.round(node.confidence * 100)}%)
                  </span>
                  {node.children.size > 0 && (
                    <span style={{ color: '#6c757d', fontSize: '9px' }}>
                      {' '}[{node.children.size}]
                    </span>
                  )}
                </div>
              ))}
              {parsimonyTree.length > 30 && (
                <div style={{ textAlign: 'center', color: '#6c757d', fontSize: '9px', marginTop: '8px' }}>
                  Showing first 30 of {parsimonyTree.length} lineages
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* All Conflicts Detail */}
        {conflicts.length > 0 && (
          <CollapsibleSection title={`📋 All Conflicts Detail (${conflicts.length})`}>
            <DataTable 
              data={conflicts.map(conflict => ({
                nodeId: `Node ${conflict.nodeId}`,
                type: conflict.type,
                sample: conflict.sample,
                expected: conflict.expected,
                source: conflict.source
              }))}
              columns={[
                { key: 'nodeId', label: 'Node ID', width: '15%' },
                { key: 'sample', label: 'Sample Label', width: '25%' },
                { key: 'expected', label: 'Expected', width: '25%' },
                { key: 'source', label: 'Conflict Type', width: '35%' },
              ]}
            />
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
};

const LineageManagerWithTree = (args: any) => {
  console.log('LineageManagerWithTree rendering...', args);
  
  const [tree] = useState(() => new RobustLineageTree());
  const [count, setCount] = useState(0);
  const [selectedLineageType, setSelectedLineageType] = useState<string>('pango_lineage');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const decompressGzip = async (response: Response): Promise<string> => {
      try {
        console.log('Decompressing gzipped data...');
        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Check if it's actually gzipped (starts with magic bytes 0x1f, 0x8b)
        if (uint8Array[0] === 0x1f && uint8Array[1] === 0x8b) {
          console.log('Detected gzip format, using pako to decompress...');
          
          // Use pako to inflate the gzipped data
          const decompressed = pako.inflate(uint8Array, { to: 'string' });
          console.log(`Decompression successful: ${uint8Array.length} bytes -> ${decompressed.length} chars`);
          return decompressed;
        } else {
          console.log('Data is not gzipped, treating as plain text');
          return new TextDecoder().decode(uint8Array);
        }
      } catch (err) {
        console.error('Pako decompression failed:', err);
        
        // Fallback to browser DecompressionStream if available
        if ('DecompressionStream' in window) {
          try {
            console.log('Trying browser DecompressionStream as fallback...');
            const stream = response.body;
            if (stream) {
              const decompressionStream = new (window as any).DecompressionStream('gzip');
              const decompressedStream = stream.pipeThrough(decompressionStream);
              const decompressedResponse = new Response(decompressedStream);
              return await decompressedResponse.text();
            }
          } catch (streamErr) {
            console.warn('DecompressionStream also failed:', streamErr);
          }
        }
        
        throw new Error(`Failed to decompress gzipped data: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    };

    const processJSONL = async () => {
      try {
        setLoading(true);
        console.log('Fetching JSONL data...');
        
        const url = args.sourceData?.filename || 
                   "https://cov2tree.nyc3.cdn.digitaloceanspaces.com/tfci-taxonium.jsonl.gz"; // Back to .gz with decompression
        
        console.log('Fetching from URL:', url);
        
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch JSONL file (${response.status})`);
        }
        
        console.log('Response received, checking if decompression is needed...');
        
        let text: string;
        if (url.endsWith('.gz')) {
          console.log('File has .gz extension, attempting decompression...');
          text = await decompressGzip(response);
          console.log('Decompression completed successfully');
        } else {
          text = await response.text();
        }
        
        if (!text || text.length === 0) {
          throw new Error('Empty response after decompression');
        }
        
        // Validate the decompressed content
        const firstLine = text.split('\n')[0];
        console.log('First line sample (first 200 chars):', firstLine.substring(0, 200));
        
        // Check if decompression was successful (should start with JSON)
        if (firstLine.trim().startsWith('{') || firstLine.trim().startsWith('[')) {
          console.log('✅ Content appears to be valid JSON');
        } else {
          console.warn('⚠️ Content may not be valid JSON, first line:', firstLine.substring(0, 100));
        }
        
        // Additional check for binary content
        if (firstLine.includes('\u0000') || /[^\x20-\x7E\s\n\r\t]/.test(firstLine.substring(0, 200))) {
          console.error('❌ Content still appears to contain binary data');
          throw new Error('Decompression may have failed - data still appears binary');
        }
        
        console.log('Processing JSONL lines...');
        const lines = text.split('\n').filter(line => line.trim());
        console.log(`Found ${lines.length} lines to process`);
        
        let processedCount = 0;
        let validNodes = 0;
        
        for (const line of lines) {
          try {
            const nodeData = JSON.parse(line);
            
            // Extract node information directly from JSONL structure
            if (nodeData.node_id !== undefined) {
              const nodeId = nodeData.node_id;
              const parentId = nodeData.parent_id || null;
              
              tree.addNode(nodeId, parentId, nodeData);
              validNodes++;
              
              if (validNodes % 1000 === 0) {
                console.log(`Processed ${validNodes} valid nodes from JSONL...`);
                setCount(validNodes);
              }
            }
            processedCount++;
            
          } catch (lineError) {
            console.warn('Failed to parse line:', line.substring(0, 100), 'Error:', lineError);
            // Stop processing if we get too many parse errors early on
            if (processedCount < 20 && (processedCount - validNodes) > 10) {
              throw new Error('Multiple JSON parse errors detected. Decompression may have failed.');
            }
          }
        }
        
        setCount(validNodes);
        console.log(`\n${'='.repeat(60)}`);
        console.log(`JSONL PROCESSING COMPLETE:`);
        console.log(`  Total lines processed: ${processedCount}`);
        console.log(`  Valid nodes found: ${validNodes}`);
        console.log(`  Parse success rate: ${processedCount > 0 ? ((validNodes/processedCount)*100).toFixed(1) : 0}%`);
        console.log(`  📊 COMPLETE DATASET: Processing ALL ${validNodes} nodes (no subsampling)`);
        console.log('='.repeat(60));
        
        if (validNodes === 0) {
          throw new Error('No valid nodes found in JSONL file. Please check the file format.');
        }
        
        // Verify we have the complete dataset
        if (validNodes === processedCount) {
          console.log('✅ All JSONL lines were valid nodes - complete dataset confirmed');
        } else {
          console.log(`⚠️ ${processedCount - validNodes} lines were not valid nodes (may be metadata/headers)`);
        }
        
        tree.analyze();
        setLoading(false);
        
      } catch (err) {
        console.error('Error processing JSONL:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      }
    };

    processJSONL();
  }, [args.sourceData?.filename, tree]);

  // Keep the original callback as fallback (but it shouldn't be needed now)
  const handleNodeDetailsLoaded = (nodeId: string | number | null, details: any) => {
    // This should rarely be called now since we're processing JSONL directly
    // But if it is called, let's track how many nodes Taxonium is loading
    console.log('⚠️ Fallback Taxonium node details loaded for node:', nodeId);
    console.log('This indicates Taxonium may be loading nodes separately from our JSONL processing');
    
    // If Taxonium is loading nodes, we want to make sure we get all of them
    if (nodeId && details) {
      console.log('Node details structure:', Object.keys(details));
    }
  };

  console.log('Rendering with count:', count);

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <LineageParsimonyPanel tree={tree} selectedType={selectedLineageType} />
      <div style={{ flex: 1 }}>
        <div style={{ 
          padding: '8px', 
          borderBottom: '1px solid #dee2e6', 
          backgroundColor: '#fff',
          display: 'flex',
          gap: '8px',
          alignItems: 'center'
        }}>
          <label style={{ fontSize: '12px', color: '#495057' }}>Lineage Type:</label>
          <select 
            value={selectedLineageType}
            onChange={(e) => setSelectedLineageType(e.target.value)}
            style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ced4da' }}
          >
            <option value="pango_lineage">Pango Lineage</option>
            <option value="nextstrain_clade">Nextstrain Clade</option>
            <option value="who_name">WHO Name</option>
            <option value="lineage">Lineage</option>
          </select>
          <div style={{ 
            marginLeft: 'auto', 
            display: 'flex', 
            gap: '12px', 
            fontSize: '11px', 
            color: '#6c757d' 
          }}>
            {loading ? (
              <>
                <span>� Loading JSONL data...</span>
                <span>�📊 {count} nodes processed</span>
              </>
            ) : error ? (
              <span style={{ color: '#dc3545' }}>❌ Error: {error}</span>
            ) : (
              <>
                <span>✅ JSONL processed: {count} nodes</span>
                <span>📈 Analysis complete</span>
              </>
            )}
          </div>
        </div>
        <div style={{ height: 'calc(100% - 41px)' }}>
          <Taxonium {...args} onNodeDetailsLoaded={handleNodeDetailsLoaded} />
        </div>
      </div>
    </div>
  );
};

export const LineageManager: Story = {
  args: {
    sourceData: {
      status: "url_supplied",
      filename: "https://cov2tree.nyc3.cdn.digitaloceanspaces.com/tfci-taxonium.jsonl.gz", // Back to .gz with client-side decompression
      filetype: "jsonl",
    },
    // Ensure we get ALL nodes by setting initial view to encompass entire tree
    query: {
      xType: "x_dist",
      zoomToSearch: {},
      // Set very wide initial bounds to load all nodes from the start
      boundsForQueries: {
        min_x: -999999,
        max_x: 999999,
        min_y: -999999, 
        max_y: 999999,
        zoom: [0.001, 0.001, 0.001], // Very zoomed out to see everything
      },
      // Force initial load of all data
      initialLoad: true,
      loadAllData: true,
    },
    // Override any viewport limits
    config: {
      loadAllNodes: true,
      maxNodesToDisplay: 999999,
      enableSubsampling: false,
    },
  },
  render: (args) => <LineageManagerWithTree {...args} />,
};
