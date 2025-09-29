import { TreeNode, LineageNode, LineageStats, LineageDistribution, ConflictLineage } from './types';

export class RobustLineageTree {
  private nodes = new Map<number, TreeNode>();
  private parsimonyTrees = new Map<string, Map<string, LineageNode>>();
  private stats: LineageStats = { processed: 0, conflicts: 0, missing: 0 };

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

  getStats(): LineageStats { 
    return { ...this.stats }; 
  }

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

  getLineageDistribution(lineageType: string): LineageDistribution[] {
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

  getTopConflictLineages(lineageType: string, limit = 10): ConflictLineage[] {
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
