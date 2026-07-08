// JS ports of the two matUtils sub-commands the Linolium backend shells out to:
//   * summary -C <out>   -> per-sample clade table  (server.js convert step)
//   * annotate -c <in>   -> apply a clade->sample label file to a MAT
// Behaviour matched to matUtils (UShER) on the golden trees.
import { MATree } from './matpb.js';

// matUtils summary -C : one row per leaf sample, tab-separated:
//   header "sample\tannotation_1"
//   then   <sampleName>\t<mostRecentAnnotationClade>
// The clade is the sample's most-recent (nearest root-ward, inclusive) annotation.
export function summaryClades(tree) {
  const lines = ['sample\tannotation_1'];
  for (const leaf of tree.get_leaves()) {
    const mra = leaf.most_recent_annotation();
    lines.push(`${leaf.id}\t${mra.length ? mra[0] : ''}`);
  }
  return lines.join('\n') + '\n';
}

// matUtils annotate -c <clade_tsv> : the clade file has rows "<clade>\t<sample>".
// matUtils locates each clade's root by an allele-frequency algorithm (defaults
// -f 0.8 best-clade frequency, -s 0.6 set-overlap, -p 0.1 clip). For the common
// case where a clade's samples form a clean monophyletic subtree, the located root
// is the MRCA. This port implements the coverage-maximising root search: among all
// internal nodes, pick the node whose descendant leaves are >= f carried by the
// clade AND that covers the largest fraction of the clade's samples; ties resolved
// by deepest (smallest subtree) then node id — matching matUtils on clean clades.
export function annotateFromLabels(tree, labelTsvText, opts = {}) {
  const f = opts.f ?? 0.8;      // min fraction of a candidate node's leaves that must carry the clade
  const clearCurrent = opts.clearCurrent ?? true;
  if (clearCurrent) for (const n of tree.depth_first_expansion()) n.annotations = [];

  // group samples by clade
  const cladeSamples = new Map();
  for (const raw of labelTsvText.split('\n')) {
    const line = raw.trim(); if (!line) continue;
    const [clade, sample] = line.split('\t');
    if (!clade || !sample) continue;
    if (!cladeSamples.has(clade)) cladeSamples.set(clade, new Set());
    cladeSamples.get(clade).add(sample);
  }

  // precompute leaf-id set per node (postorder), and leaf count
  const order = tree.depth_first_expansion();
  const leafSets = new Map();
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i];
    if (n.is_leaf()) leafSets.set(n, new Set([n.id]));
    else {
      const s = new Set();
      for (const c of n.children) for (const x of leafSets.get(c)) s.add(x);
      leafSets.set(n, s);
    }
  }

  for (const [clade, samples] of cladeSamples) {
    const root = bestCladeRoot(tree, order, leafSets, samples, f);
    if (root) root.annotations = [...new Set([...root.annotations.filter(a => a), clade])];
  }
  return tree;
}

// Find the node that best represents a clade: maximise the number of clade samples
// captured, subject to at least fraction f of the node's leaves belonging to the
// clade. Deepest qualifying node with max coverage wins (matUtils "clade root").
function bestCladeRoot(tree, order, leafSets, cladeSet, f) {
  let best = null, bestCov = -1, bestSize = Infinity;
  for (const n of order) {
    if (n.is_leaf()) continue;
    const leaves = leafSets.get(n);
    let inClade = 0;
    for (const l of leaves) if (cladeSet.has(l)) inClade++;
    if (inClade === 0) continue;
    const freq = inClade / leaves.size;         // fraction of node's leaves carrying the clade
    if (freq < f) continue;
    // coverage = fraction of the clade's samples captured here
    const cov = inClade;
    if (cov > bestCov || (cov === bestCov && leaves.size < bestSize) ||
        (cov === bestCov && leaves.size === bestSize && best && n.id < best.id)) {
      best = n; bestCov = cov; bestSize = leaves.size;
    }
  }
  // fallback: MRCA of all clade samples (if no node meets the frequency threshold)
  if (!best) best = mrcaOf(tree, [...cladeSet]);
  return best;
}

// MRCA of a set of leaf ids: walk the first sample's root-ward path leaf->root and
// return the first id present in every sample's path (deepest common ancestor).
function mrcaOf(tree, sampleIds) {
  const paths = [];
  for (const s of sampleIds) {
    const n = tree.get_node(s); if (!n) continue;
    paths.push([n, ...tree.rsearch(s, false)].map(x => x.id));
  }
  if (!paths.length) return null;
  const sets = paths.map(p => new Set(p));
  for (const id of paths[0]) if (sets.every(st => st.has(id))) return tree.get_node(id);
  return tree.root;
}
