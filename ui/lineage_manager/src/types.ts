export interface TreeNode {
  id: number;
  parentId: number | null;
  isLeaf: boolean;
  sampleLineages: Map<string, string>; // sample-level annotations
  cladeLineages: Map<string, string>;  // clade-level annotations
  inferredLineages: Map<string, string>; // parsimony-inferred
  children: Set<number>;
  conflicts: Array<{ type: string; sample: string; expected: string; source: string }>;
}

export interface LineageNode {
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

export interface LineageStats {
  processed: number;
  conflicts: number;
  missing: number;
}

export interface LineageDistribution {
  name: string;
  total: number;
  sample: number;
  clade: number;
  inferred: number;
  conflicts: number;
  confidence: number;
}

export interface ConflictLineage {
  name: string;
  conflictRate: number;
  total: number;
  conflicts: number;
}
