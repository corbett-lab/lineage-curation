// JS port of taxoniumtools.usher_to_taxonium (the --clade_types pango path the
// Linolium converter uses). Produces the Taxonium jsonl (array of newline-delimited
// JSON records; first record is the header with the global mutation table).
// Layout math mirrors taxoniumtools/utils.py + ushertools.py exactly:
//   * edge_length = number of nuc mutations on the node
//   * ladderize(ascending=False): sort children by (num_descendants, edge_length, label)
//   * x_dist = parent.x_dist + edge_length, normalised so the 95th percentile -> 600
//   * terminal y = sequential index over leaves (post-ladderize preorder-leaf order)
//   * internal y = midpoint of children's y
//   * nodes emitted sorted by y; parent_id/node_id index into that ordering
import { MATree } from './matpb.js';

const VERSION = '2.1.24';

function numDescendants(order) {
  // postorder: leaves 0; internal = sum(child counts) + num children
  const nd = new Map();
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i];
    if (n.is_leaf()) nd.set(n, 0);
    else nd.set(n, n.children.reduce((s, c) => s + nd.get(c), 0) + n.children.length);
  }
  return nd;
}

function ladderize(root, order) {
  // treeswift order('num_descendants_then_edge_length_then_label', ascending=False)
  const nd = numDescendants(order);
  // treeswift key: (num_descendants, edge_length is not None, edge_length,
  //                 label is not None, label). CRITICAL: the golden .pb newick has
  //                 NO internal labels -> treeswift sees internal node.label == None.
  //                 Only leaves carry a label (the sample name). Our reader assigns
  //                 synthetic node_N ids to internals, but those must NOT participate
  //                 in the tiebreak, or we break ties treeswift leaves in newick order.
  const labelOf = n => (n.is_leaf() ? n.id : null);
  for (const node of order) {
    node.children.sort((a, b) => {
      // descending (reverse=True) on the full tuple; stable for full ties
      const na = nd.get(a), nbb = nd.get(b);
      if (na !== nbb) return nbb - na;
      const ea = a.edge_length ?? -Infinity, eb = b.edge_length ?? -Infinity;
      if (ea !== eb) return eb - ea;
      const la = labelOf(a), lb = labelOf(b);
      // (label is not None) ranks: a real label sorts as True(1) > None(0);
      // reverse=True => higher (has-label / larger string) comes first
      const ha = la !== null ? 1 : 0, hb = lb !== null ? 1 : 0;
      if (ha !== hb) return hb - ha;
      if (ha === 0) return 0;                 // both None -> full tie -> keep order
      return la < lb ? 1 : la > lb ? -1 : 0;  // both have labels -> descending
    });
  }
}

function preorder(root) {
  // Match treeswift Node.traverse_preorder EXACTLY: a stack, push children in list
  // order, pop from the end -> children visited in REVERSE list order.
  const out = []; const s = [root];
  while (s.length) { const n = s.pop(); out.push(n); for (const c of n.children) s.push(c); }
  return out;
}
function leavesInPreorder(root) { return preorder(root).filter(n => n.is_leaf()); }
// (preorder already replicates treeswift's stack order, so leaf order is correct)

// parse "G497953A" -> {par:'G', pos:497953, mut:'A'}
function parseMutStr(m) {
  const mm = /^([A-Z])(\d+)([A-Z])$/.exec(m);
  return { par: mm[1], pos: parseInt(mm[2], 10), mut: mm[3] };
}

export function toTaxonium(tree, cladeMap /* Map sampleId->cladeString */, columns = ['strain', 'annotation_1']) {
  // edge_length = #nuc mutations
  const order0 = tree.depth_first_expansion();
  for (const n of order0) n.edge_length = n.mutations.length;

  ladderize(tree.root, order0);

  // recompute preorder after ladderize
  const pre = preorder(tree.root);

  // num_tips (postorder)
  const numTips = new Map();
  for (let i = pre.length - 1; i >= 0; i--) {
    const n = pre[i];
    numTips.set(n, n.is_leaf() ? 1 : n.children.reduce((s, c) => s + numTips.get(c), 0));
  }

  // x_dist (preorder accumulate), then normalise 95th pct -> 600
  tree.root.x_dist = 0;
  for (const n of pre) if (n.parent) n.x_dist = n.parent.x_dist + n.edge_length;
  const xs = pre.map(n => n.x_dist).sort((a, b) => a - b);
  const pct95 = xs[Math.floor(xs.length * 0.95)];
  for (const n of pre) n.x_dist = pct95 ? 600 * (n.x_dist / pct95) : 0;

  // terminal y then internal y
  const leaves = leavesInPreorder(tree.root);
  leaves.forEach((n, i) => { n.y = i; });
  for (let i = pre.length - 1; i >= 0; i--) {
    const n = pre[i];
    if (!n.is_leaf()) {
      const cy = n.children.map(c => c.y);
      n.y = (Math.min(...cy) + Math.max(...cy)) / 2;
    }
  }

  // global mutation table (dedup by string), id = index
  const mutIndex = new Map(); const mutObjects = [];
  for (const n of pre) {
    for (const m of n.mutations) {
      if (!mutIndex.has(m)) {
        const { par, pos, mut } = parseMutStr(m);
        mutIndex.set(m, mutObjects.length);
        mutObjects.push({ gene: 'nt', previous_residue: par, residue_pos: pos, new_residue: mut, mutation_id: mutObjects.length, type: 'nt' });
      }
    }
  }

  // nodes sorted by y; node_to_index in that order
  const sorted = [...pre].sort((a, b) => a.y - b.y);
  const nodeToIndex = new Map(sorted.map((n, i) => [n, i]));

  const header = {
    version: VERSION,
    mutations: mutObjects,
    total_nodes: sorted.length,
    config: { num_tips: numTips.get(tree.root), date_created: new Date().toISOString().slice(0, 10) },
  };

  const records = [header];
  for (const n of sorted) {
    const isLeaf = n.is_leaf();
    const clade = isLeaf ? (cladeMap.get(n.id) ?? '') : '';
    const rec = {
      name: n.id || '',
      x_dist: Math.round(n.x_dist * 1e5) / 1e5,
      y: n.y,
      mutations: n.mutations.map(m => mutIndex.get(m)),
      is_tip: isLeaf,
      meta_annotation_1: clade,
      parent_id: n.parent ? nodeToIndex.get(n.parent) : nodeToIndex.get(n),
      node_id: nodeToIndex.get(n),
      num_tips: numTips.get(n),
      clades: { pango: '' },
    };
    records.push(rec);
  }
  return records;
}
