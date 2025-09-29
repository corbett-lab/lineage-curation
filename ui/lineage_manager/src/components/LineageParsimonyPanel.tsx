import React from 'react';
import { RobustLineageTree } from '../RobustLineageTree';
import { LineageNode } from '../types';
import { CollapsibleSection, DataTable, StatCard } from './UIComponents';

interface LineageParsimonyPanelProps {
  tree: RobustLineageTree;
  selectedType: string;
}

export const LineageParsimonyPanel: React.FC<LineageParsimonyPanelProps> = ({ 
  tree, 
  selectedType 
}) => {
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
