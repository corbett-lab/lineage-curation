// lineageEditing.js — the in-browser local backend's lineage-editing surface.
// The edit ENGINE (merge / edit-root / undo-with-conflict-closure / lineage
// hierarchy) lives in the shared module ../../../shared/lineageEditCore.cjs and is
// the SAME code the Express backend (server.js) runs, so the two modes can't drift.
// This module adds the two things that are legitimately client-specific:
//   * the export "modified" baseline (originalLineages, captured lazily on first
//     edit), and
//   * the export builders (jsonl / metadata / clades / pb — the pb export is a
//     corrected MRCA-based version, not the backend's).

import * as core from '../../../shared/lineageEditCore.cjs';

let originalLineages = null; // Map node_id -> original lineage, captured at first edit

export function resetEditing() {
  core.resetEditHistory();
  originalLineages = null;
}

export function captureOriginalLineages(processedData, field) {
  if (originalLineages !== null) return;
  originalLineages = new Map();
  for (const node of processedData.nodes) {
    if (node.is_tip) originalLineages.set(node.node_id, node[field] || '');
  }
}

export function getOriginalLineages() { return originalLineages; }

export function getEditHistory() { return core.getEditHistory(); }

export function getLineages(processedData, field = 'meta_annotation_1') {
  return core.getLineages(processedData, field);
}

// Capture the baseline (for the export "modified" column) before the first edit,
// then delegate to the shared engine.
export function mergeLineage(processedData, lineageName, field) {
  captureOriginalLineages(processedData, field);
  return core.mergeLineage(processedData, lineageName, field);
}

export function editLineageRoot(processedData, lineageName, rootNodeId, field) {
  captureOriginalLineages(processedData, field);
  return core.editLineageRoot(processedData, lineageName, rootNodeId, field);
}

export function undoPreview(targetId) { return core.undoPreview(targetId); }

export function undoEdit(processedData, id) { return core.undoEdit(processedData, id); }

// ---- exports (client-side ports of /export/jsonl, /export/metadata) -----
// Returns { format, text? , note? }. The pb export is handled separately in the
// client pipeline (needs the original .pb bytes + the matUtils annotate JS port).

const LINEAGE_KEYS = ['meta_annotation_1','meta_lineage','meta_pango_lineage','meta_Nextclade_pango','meta_pangolin_lineage','lineage'];
function nodeLineage(node) {
  for (const k of LINEAGE_KEYS) if (node[k]) return node[k];
  return '';
}

export function buildExport(processedData, format, field = 'meta_annotation_1', config = {}) {
  if (format === 'jsonl') return { format, text: buildJsonl(processedData, config) };
  if (format === 'metadata') return { format, text: buildMetadata(processedData) };
  if (format === 'clades') return { format, text: buildCladeFile(processedData) };
  return { error: `Unknown export format: ${format}` };
}

// Mirrors /export/jsonl: header line + one node object per line.
function buildJsonl(processedData, config = {}) {
  const pd = processedData;
  const header = {
    total_nodes: pd.nodes.length,
    mutations: pd.mutations || [],
    overallMinX: pd.overallMinX, overallMaxX: pd.overallMaxX,
    overallMinY: pd.overallMinY, overallMaxY: pd.overallMaxY,
    y_positions: pd.y_positions || [],
    rootMutations: pd.rootMutations || [],
    rootId: pd.rootId,
    title: config.title || 'Exported Taxonium Tree',
    source: config.source || 'Taxonium Export',
    export_timestamp: new Date().toISOString(),
    exported_from: 'taxonium_browser',
  };
  const lines = [JSON.stringify(header)];
  for (const node of pd.nodes) {
    const nodeObj = {
      node_id: node.node_id,
      parent_id: node.parent_id,
      name: node.name || '',
      x_dist: node.x_dist,
      y: node.y,
      mutations: (pd.node_to_mut && pd.node_to_mut[node.node_id]) || [],
      is_tip: node.is_tip || false,
      num_tips: node.num_tips || 0,
    };
    if (node.x_time !== undefined) nodeObj.x_time = node.x_time;
    for (const key of Object.keys(node)) if (key.startsWith('meta_')) nodeObj[key] = node[key];
    lines.push(JSON.stringify(nodeObj));
  }
  return lines.join('\n') + '\n';
}

// Mirrors /export/metadata: sample\tlineage\tmodified TSV.
function buildMetadata(processedData) {
  const orig = originalLineages || new Map();
  const out = ['sample\tlineage\tmodified'];
  for (const node of processedData.nodes) {
    if (!node.is_tip) continue;
    const name = node.name || node.node_id || '';
    const lineage = nodeLineage(node);
    const o = orig.get(node.node_id) || '';
    out.push(`${name}\t${lineage}\t${lineage !== o ? 1 : 0}`);
  }
  return out.join('\n') + '\n';
}

// Clade file for the pb export (lineage\tnode_id for non-tip nodes with a lineage),
// matching the backend's /export/pb clade-file construction.
function buildCladeFile(processedData) {
  const lines = [];
  for (const node of processedData.nodes) {
    const lineage = nodeLineage(node);
    if (lineage && !node.is_tip) lines.push(`${lineage}\t${node.name || node.node_id}`);
  }
  return lines.join('\n') + '\n';
}


// ---- pb export (correct sample-based MRCA annotate + saveMatPb) ----------
// The backend's /export/pb runs `matUtils annotate -c <lineage\tnode_id>` which
// no-ops on non-sample node names and emits an UNannotated tree (lossy — see
// design memo). We do it correctly: group the current tip->lineage labels, set
// each lineage's annotation at the MRCA of its tips on the original .pb tree,
// then re-serialize. Requires the MATree class + saveMatPb from matpb.js, passed
// in to keep this module dependency-light.
export function buildPbExport(processedData, MATree, saveMatPb, pbBytes, field = 'meta_annotation_1') {
  const tipLineage = new Map();
  for (const n of processedData.nodes) if (n.is_tip && n[field]) tipLineage.set(n.name, n[field]);

  const t = new MATree(pbBytes instanceof Uint8Array ? pbBytes : new Uint8Array(pbBytes));
  const byLineage = new Map();
  for (const leaf of t.get_leaves()) {
    const lin = tipLineage.get(leaf.id);
    if (lin) { if (!byLineage.has(lin)) byLineage.set(lin, []); byLineage.get(lin).push(leaf.id); }
  }
  for (const node of t.depth_first_expansion()) node.annotations = [];
  const mrca = (ids) => {
    if (ids.length === 1) return t.get_node(ids[0]);
    const paths = ids.map(s => [t.get_node(s), ...t.rsearch(s, false)].map(x => x.id));
    const sets = paths.map(p => new Set(p));
    for (const id of paths[0]) if (sets.every(st => st.has(id))) return t.get_node(id);
    return t.root;
  };
  for (const [lin, ids] of byLineage) { const m = mrca(ids); if (m) m.annotations = [...new Set([...m.annotations, lin])]; }
  return saveMatPb(t);
}
