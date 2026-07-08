// Shared lineage-edit engine — the single source of truth for merge /
// edit-lineage-root / undo (conflict-aware) / lineage-hierarchy, used by BOTH:
//   * the Express backend  (server.js, CommonJS — `require`s this)
//   * the in-browser local backend worker (lineageEditing.js, ESM — imports this
//     via vite's CJS interop)
// so the two modes can't drift. Every operation is an in-memory transform on the
// Taxonium node array (processedData.nodes) plus a module-level editHistory.
//
// What is intentionally NOT here (kept per-caller, because it genuinely differs):
//   * the export "modified" baseline (originalLineages): the server captures ALL
//     nodes with a multi-field fallback on data load, the worker captures tips
//     lazily on first edit;
//   * the export builders (jsonl/metadata/clades/pb): the worker's pb export is a
//     corrected MRCA-based version, not the backend's.
// The two callers therefore capture their own baseline before delegating here.

let editHistory = [];

function resetEditHistory() { editHistory = []; }

function getEditHistory() {
  return editHistory.map((entry) => ({
    id: entry.id,
    action: entry.action,
    lineageName: entry.lineageName,
    parentLineage: entry.parentLineage,
    description: entry.description,
    timestamp: entry.timestamp,
    affectedLineages: entry.affectedLineages || [],
  }));
}

// ---- shared helpers -----------------------------------------------------

function buildLookup(processedData) {
  const nodeLookup = {};
  processedData.nodes.forEach((node) => { nodeLookup[node.node_id] = node; });
  return nodeLookup;
}

// Rebuild clade labels by finding the MRCA of each lineage's tips.
function rebuildCladeLabels(processedData, field) {
  const nodeLookup = buildLookup(processedData);

  processedData.nodes.forEach((node) => {
    if (!node.is_tip && node.clades) delete node.clades.pango;
  });

  const lineageTips = {};
  processedData.nodes.forEach((node) => {
    if (node.is_tip && node[field]) {
      const lin = node[field];
      if (!lineageTips[lin]) lineageTips[lin] = [];
      lineageTips[lin].push(node.node_id);
    }
  });

  // depth per node (memoized walk to root)
  const depth = {};
  processedData.nodes.forEach((node) => {
    if (depth[node.node_id] !== undefined) return;
    const stack = [];
    let cur = node;
    while (depth[cur.node_id] === undefined) {
      stack.push(cur.node_id);
      if (cur.parent_id === cur.node_id) { depth[cur.node_id] = 0; stack.pop(); break; }
      cur = nodeLookup[cur.parent_id];
    }
    let d = depth[cur.node_id];
    while (stack.length > 0) { d++; depth[stack.pop()] = d; }
  });

  const lca = (a, b) => {
    let na = a, nb = b;
    while (depth[na] > depth[nb]) na = nodeLookup[na].parent_id;
    while (depth[nb] > depth[na]) nb = nodeLookup[nb].parent_id;
    while (na !== nb) { na = nodeLookup[na].parent_id; nb = nodeLookup[nb].parent_id; }
    return na;
  };

  for (const [lineage, tips] of Object.entries(lineageTips)) {
    if (tips.length === 0) continue;
    let mrca = tips[0];
    for (let i = 1; i < tips.length; i++) mrca = lca(mrca, tips[i]);
    const mrcaNode = nodeLookup[mrca];
    // Clade labels live on internal nodes only. A single-tip lineage's MRCA is
    // the tip itself, so it is dropped on rebuild — matching the reference
    // backend, which also sheds single-tip lineages whenever it recomputes.
    if (mrcaNode && !mrcaNode.is_tip) {
      if (!mrcaNode.clades) mrcaNode.clades = {};
      mrcaNode.clades.pango = lineage;
    }
  }
}

function snapshotTips(processedData, field, nodeIds) {
  const snapshot = {};
  for (const node of processedData.nodes) {
    if (node.is_tip && nodeIds.has(node.node_id)) snapshot[node.node_id] = node[field] || '';
  }
  return snapshot;
}

// ---- /lineages : hierarchy from clade labels ----------------------------

function getLineages(processedData, field = 'meta_annotation_1') {
  const nodeLookup = {};
  const children = {};
  let totalNodes = 0, nodesWithLineage = 0;

  processedData.nodes.forEach((node) => {
    totalNodes++;
    nodeLookup[node.node_id] = node;
    if (node[field] && node[field] !== '') nodesWithLineage++;
    if (node.parent_id && node.parent_id !== node.node_id) {
      if (!children[node.parent_id]) children[node.parent_id] = [];
      children[node.parent_id].push(node.node_id);
    }
  });

  const getAllDescendants = (nodeId) => {
    const descendants = [];
    const toVisit = (children[nodeId] || []).slice();
    while (toVisit.length > 0) {
      const cur = toVisit.pop();
      descendants.push(cur);
      if (children[cur]) toVisit.push(...children[cur]);
    }
    return descendants;
  };

  const cladeNodeMap = new Map();
  for (const node of processedData.nodes) {
    if (node.clades && node.clades.pango && !node.is_tip) cladeNodeMap.set(node.clades.pango, node);
  }

  const findParentLineage = (nodeId, currentCladeLabel) => {
    let currentNode = nodeLookup[nodeId];
    while (currentNode && currentNode.parent_id && currentNode.parent_id !== currentNode.node_id) {
      const parentNode = nodeLookup[currentNode.parent_id];
      if (parentNode && parentNode.clades && parentNode.clades.pango) {
        if (parentNode.clades.pango !== currentCladeLabel) return parentNode.clades.pango;
      }
      currentNode = parentNode;
    }
    return null;
  };

  const lineageHierarchy = new Map();
  for (const [cladeLabel, cladeNode] of cladeNodeMap.entries()) {
    const descendants = getAllDescendants(cladeNode.node_id);
    const descendantLineageSet = new Set();
    let totalTips = 0;
    descendants.forEach((descId) => {
      const descNode = nodeLookup[descId];
      if (descNode && descNode.is_tip) {
        totalTips++;
        if (descNode[field] && descNode[field] !== '' && descNode[field] !== cladeLabel) {
          descendantLineageSet.add(descNode[field]);
        }
      }
    });
    const parentLineage = findParentLineage(cladeNode.node_id, cladeLabel);
    lineageHierarchy.set(cladeLabel, {
      value: cladeLabel,
      count: totalTips,
      descendantLineages: descendantLineageSet.size,
      descendantLeaves: totalTips,
      parent: parentLineage,
    });
  }

  const lineageArray = Array.from(lineageHierarchy.values());
  lineageArray.sort((a, b) => b.count - a.count);
  return {
    lineages: lineageArray,
    field,
    totalNodes,
    nodesWithLineage,
    uniqueLineages: lineageArray.length,
  };
}

// ---- /merge-lineage -----------------------------------------------------

function mergeLineage(processedData, lineageName, field) {
  if (!lineageName || !field) return { error: 'Missing required parameters: lineageName, field' };

  const nodeLookup = buildLookup(processedData);
  let cladeNode = null;
  for (const node of processedData.nodes) {
    if (!node.is_tip && node.clades && node.clades.pango === lineageName) { cladeNode = node; break; }
  }
  let parentLineage = null;
  if (cladeNode) {
    let current = nodeLookup[cladeNode.parent_id];
    while (current) {
      if (current.clades && current.clades.pango && current.clades.pango !== lineageName) {
        parentLineage = current.clades.pango; break;
      }
      if (current.parent_id === current.node_id) break;
      current = nodeLookup[current.parent_id];
    }
  }
  if (!parentLineage) return { error: `Cannot merge "${lineageName}" - no parent lineage found in tree` };

  const isLineageToMerge = (nl) => nl === lineageName || nl.startsWith(lineageName + '.');

  const affectedNodeIds = new Set();
  processedData.nodes.forEach((node) => {
    if (node.is_tip && node[field] && isLineageToMerge(node[field])) affectedNodeIds.add(node.node_id);
  });
  const snapshot = snapshotTips(processedData, field, affectedNodeIds);

  let mergedCount = 0;
  const affectedLineages = new Set();
  processedData.nodes.forEach((node) => {
    if (node.is_tip && node[field] && isLineageToMerge(node[field])) {
      affectedLineages.add(node[field]);
      node[field] = parentLineage;
      mergedCount++;
    }
  });

  rebuildCladeLabels(processedData, field);

  editHistory.push({
    id: editHistory.length,
    action: 'merge',
    lineageName, parentLineage, field,
    description: `Merged ${lineageName} into ${parentLineage} (${mergedCount} nodes)`,
    timestamp: new Date().toISOString(),
    snapshot,
    affectedLineages: [lineageName, parentLineage, ...affectedLineages],
  });

  return {
    success: true, mergedCount, parentLineage,
    affectedLineages: Array.from(affectedLineages),
    message: `Merged ${mergedCount} samples into ${parentLineage}`,
  };
}

// ---- /edit-lineage-root -------------------------------------------------

function editLineageRoot(processedData, lineageName, rootNodeId, field) {
  if (!lineageName || rootNodeId === undefined || rootNodeId === null || !field) {
    return { error: 'Missing required parameters: lineageName, rootNodeId, field' };
  }

  const rootNodeIdNum = parseInt(rootNodeId, 10);
  const rootNode = processedData.nodes.find((node) => node.node_id === rootNodeId || node.node_id === rootNodeIdNum);
  if (!rootNode) return { error: `Root node ${rootNodeId} not found` };

  const nodeLookup = {};
  const children = {};
  processedData.nodes.forEach((node) => {
    nodeLookup[node.node_id] = node;
    if (node.parent_id && node.parent_id !== node.node_id) {
      if (!children[node.parent_id]) children[node.parent_id] = [];
      children[node.parent_id].push(node.node_id);
    }
  });

  const getDescendants = (nodeId) => {
    const descendants = new Set();
    const queue = [nodeId];
    while (queue.length > 0) {
      const currentId = queue.shift();
      descendants.add(currentId);
      if (children[currentId]) children[currentId].forEach((cid) => { if (!descendants.has(cid)) queue.push(cid); });
    }
    return descendants;
  };

  const childLineages = new Set();
  processedData.nodes.forEach((node) => {
    if (!node.is_tip && node.clades && node.clades.pango) {
      const clade = node.clades.pango;
      if (clade !== lineageName && clade.startsWith(lineageName + '.')) childLineages.add(clade);
      if (clade.startsWith('auto.' + lineageName + '.')) childLineages.add(clade);
    }
  });
  processedData.nodes.forEach((node) => {
    if (node.is_tip && node[field]) {
      const ann = node[field];
      if (ann !== lineageName && ann.startsWith(lineageName + '.')) childLineages.add(ann);
      if (ann.startsWith('auto.' + lineageName + '.')) childLineages.add(ann);
    }
  });
  const isChildLineage = (ann) => childLineages.has(ann);

  const rootId = rootNode.node_id;
  const targetNodeIds = getDescendants(rootId);

  let parentLineage = null;
  let cur = nodeLookup[rootNode.parent_id];
  while (cur) {
    if (cur.clades && cur.clades.pango && cur.clades.pango !== lineageName) { parentLineage = cur.clades.pango; break; }
    if (cur.parent_id === cur.node_id) break;
    cur = nodeLookup[cur.parent_id];
  }

  const affectedNodeIds = new Set();
  processedData.nodes.forEach((node) => {
    if (!node.is_tip) return;
    if (targetNodeIds.has(node.node_id)) affectedNodeIds.add(node.node_id);
    if ((node[field] || null) === lineageName) affectedNodeIds.add(node.node_id);
  });
  const snapshot = snapshotTips(processedData, field, affectedNodeIds);

  let assignedCount = 0, clearedCount = 0;
  processedData.nodes.forEach((node) => {
    if (!node.is_tip) return;
    const currentLineage = node[field] || null;
    if (targetNodeIds.has(node.node_id)) {
      if (currentLineage !== lineageName && !isChildLineage(currentLineage)) { node[field] = lineageName; assignedCount++; }
    } else if (currentLineage === lineageName) {
      node[field] = parentLineage ? parentLineage : '';
      clearedCount++;
    }
  });

  rebuildCladeLabels(processedData, field);

  const editAffectedLineages = new Set([lineageName]);
  if (parentLineage) editAffectedLineages.add(parentLineage);
  for (const val of Object.values(snapshot)) { if (val) editAffectedLineages.add(val); }

  editHistory.push({
    id: editHistory.length,
    action: 'edit-root',
    lineageName, field,
    description: `Moved ${lineageName} root to node ${rootNodeId} (${assignedCount} assigned, ${clearedCount} displaced)`,
    timestamp: new Date().toISOString(),
    snapshot,
    affectedLineages: [...editAffectedLineages],
  });

  return {
    success: true, assignedCount, clearedCount, totalAffected: targetNodeIds.size, parentLineage,
    message: `Reassigned ${lineageName} to ${assignedCount} nodes under root ${rootNodeId}`,
  };
}

// ---- undo (with transitive conflict closure) ----------------------------

// An edit conflicts if it modified any of the same node IDs as the target or any
// other edit already in the conflict set — walk forward, expanding transitively.
function computeConflictingEdits(targetId) {
  const targetIndex = editHistory.findIndex((e) => e.id === targetId);
  if (targetIndex === -1) return [];
  const target = editHistory[targetIndex];
  const taintedNodeIds = new Set(Object.keys(target.snapshot));
  const toUndo = [targetId];
  for (let i = targetIndex + 1; i < editHistory.length; i++) {
    const entry = editHistory[i];
    const entryNodeIds = Object.keys(entry.snapshot);
    if (entryNodeIds.some((id) => taintedNodeIds.has(id))) {
      toUndo.push(entry.id);
      entryNodeIds.forEach((id) => taintedNodeIds.add(id));
    }
  }
  return toUndo;
}

function undoPreview(targetId) {
  return { targetId, wouldUndo: computeConflictingEdits(targetId) };
}

function undoEdit(processedData, id) {
  if (editHistory.length === 0) return { error: 'No edits to undo' };
  const targetId = id !== undefined && id !== null ? id : editHistory[editHistory.length - 1].id;
  const targetIndex = editHistory.findIndex((e) => e.id === targetId);
  if (targetIndex === -1) return { error: `Edit ${targetId} not found` };

  const idsToUndo = new Set(computeConflictingEdits(targetId));
  const toUndo = [], toKeep = [];
  for (const entry of editHistory) { (idsToUndo.has(entry.id) ? toUndo : toKeep).push(entry); }

  // Restore snapshots newest-first so the target's original values win.
  for (let i = toUndo.length - 1; i >= 0; i--) {
    const entry = toUndo[i];
    for (const node of processedData.nodes) {
      if (node.is_tip && Object.prototype.hasOwnProperty.call(entry.snapshot, node.node_id)) {
        node[entry.field] = entry.snapshot[node.node_id];
      }
    }
  }
  rebuildCladeLabels(processedData, toUndo[0].field);

  editHistory.length = 0;
  toKeep.forEach((entry, i) => { entry.id = i; editHistory.push(entry); });

  return {
    success: true,
    undone: toUndo[0].description,
    removedCount: toUndo.length,
    removedIds: toUndo.map((e) => e.id),
    remainingEdits: editHistory.length,
  };
}

module.exports = {
  resetEditHistory,
  getEditHistory,
  getLineages,
  mergeLineage,
  editLineageRoot,
  undoPreview,
  undoEdit,
  // exposed for reuse / testing
  rebuildCladeLabels,
  snapshotTips,
  computeConflictingEdits,
};
