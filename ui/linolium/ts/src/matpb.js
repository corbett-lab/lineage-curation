// Pure-JS UShER MAT (.pb) reader/writer — no protobuf runtime, browser/Node safe.
// Mirrors browserize/schema/mat_parse.py (validated byte-exact vs bte on 3 golden
// trees). Field numbers/wire types and the ordered-index nuc codebook are the
// empirically-verified UShER schema (see parsimony.proto).

const CODE2BASE = ['A', 'C', 'G', 'T'];           // ordered index (NOT one-hot)
const BASE2CODE = { A: 0, C: 1, G: 2, T: 3, N: 0 };

// ---- varint / wire helpers ----
function readVarint(buf, i) {
  let shift = 0, result = 0;
  for (;;) {
    const b = buf[i++];
    result += (b & 0x7f) * Math.pow(2, shift);   // avoid 32-bit bitwise overflow
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [result, i];
}
function* iterFields(buf, start, end) {
  let i = start;
  while (i < end) {
    let key; [key, i] = readVarint(buf, i);
    const fno = Math.floor(key / 8), wt = key & 7;
    if (wt === 0) { let v; [v, i] = readVarint(buf, i); yield [fno, 0, v, 0]; }
    else if (wt === 2) { let ln; [ln, i] = readVarint(buf, i); yield [fno, 2, i, i + ln]; i += ln; }
    else if (wt === 5) { yield [fno, 5, i, i + 4]; i += 4; }
    else if (wt === 1) { yield [fno, 1, i, i + 8]; i += 8; }
    else throw new Error('bad wire type ' + wt);
  }
}

function parseMut(buf, s, e) {
  let pos = null, ref = null, par = null, chrom = null; const muts = [];
  for (const [fno, wt, a, b] of iterFields(buf, s, e)) {
    if (fno === 1) pos = a;
    else if (fno === 2) ref = a;
    else if (fno === 3) par = a;
    else if (fno === 4) {
      if (wt === 2) { let j = a; while (j < b) { let x; [x, j] = readVarint(buf, j); muts.push(x); } }
      else muts.push(a);
    } else if (fno === 5) chrom = new TextDecoder().decode(buf.subarray(a, b));
  }
  return { pos, ref, par, muts, chrom };
}

class Node {
  constructor(id) {
    this.id = id; this.parent = null; this.children = [];
    this.branch_length = 0.0; this.mutations = []; this.annotations = [];
  }
  is_leaf() { return this.children.length === 0; }
  most_recent_annotation() {
    let n = this;
    while (n) { const real = n.annotations.filter(a => a); if (real.length) return real; n = n.parent; }
    return [];
  }
}

// ---- newick parser (matches mat_parse.parse_newick) ----
function parseNewick(s) {
  s = s.trim(); if (s.endsWith(';')) s = s.slice(0, -1);
  let pos = 0;
  function parseClade() {
    const node = new Node(null);
    if (s[pos] === '(') {
      pos++;
      for (;;) {
        const child = parseClade(); child.parent = node; node.children.push(child);
        if (s[pos] === ',') { pos++; continue; }
        if (s[pos] === ')') { pos++; break; }
      }
    }
    const m = /^[^,():;]+/.exec(s.slice(pos));
    let label = ''; if (m) { label = m[0]; pos += label.length; }
    let bl = null;
    if (pos < s.length && s[pos] === ':') {
      pos++; const m2 = /^[0-9eE.+\-]+/.exec(s.slice(pos)); bl = parseFloat(m2[0]); pos += m2[0].length;
    }
    if (label.includes(':')) label = label.split(':')[0];
    node.id = label || null;
    if (bl !== null) node.branch_length = bl;
    return node;
  }
  return parseClade();
}

function dfsPreorder(root) {
  const out = []; const stack = [root];
  // recursive order via explicit stack keeping child order
  (function rec(n) { out.push(n); for (const ch of n.children) rec(ch); })(root);
  return out;
}

class MATree {
  constructor(bytes) {
    const buf = bytes;
    let newick = null; const nodeMuts = [], metas = [], condensedRaw = [];
    for (const [fno, wt, a, b] of iterFields(buf, 0, buf.length)) {
      if (fno === 1) newick = new TextDecoder().decode(buf.subarray(a, b));
      else if (fno === 2) nodeMuts.push([a, b]);
      else if (fno === 3) condensedRaw.push([a, b]);
      else if (fno === 4) metas.push([a, b]);
    }
    // condensed: placeholder -> [real sample names]
    this.condensed = {};
    for (const [a, b] of condensedRaw) {
      let name = null; const leaves = [];
      for (const [fno, wt, s, e] of iterFields(buf, a, b)) {
        if (fno === 1 && wt === 2) name = new TextDecoder().decode(buf.subarray(s, e));
        else if (fno === 2 && wt === 2) leaves.push(new TextDecoder().decode(buf.subarray(s, e)));
      }
      if (name !== null) this.condensed[name] = leaves;
    }
    this.root = parseNewick(newick);
    // (1) original DFS order — placeholders still leaves; mut/meta arrays in this order
    let order = dfsPreorder(this.root);
    if (order.length !== nodeMuts.length || order.length !== metas.length)
      throw new Error(`node count mismatch: newick=${order.length} muts=${nodeMuts.length} meta=${metas.length}`);
    for (let k = 0; k < order.length; k++) {
      const node = order[k];
      const [ms, me] = nodeMuts[k];
      const mstrs = [];
      for (const [fno, wt, a, b] of iterFields(buf, ms, me)) {
        if (fno === 1 && wt === 2) {
          const { pos, ref, par, muts } = parseMut(buf, a, b);
          const alt = muts.length ? (CODE2BASE[muts[0]] ?? 'N') : 'N';
          const parCode = par !== null ? par : 0;             // proto2 default-0 == 'A'
          const refb = CODE2BASE[parCode] ?? 'N';
          mstrs.push(`${refb}${pos}${alt}`);
        }
      }
      node.mutations = mstrs;
      const [as_, ae] = metas[k]; const anns = [];
      for (const [fno, wt, a, b] of iterFields(buf, as_, ae))
        if (fno === 1 && wt === 2) anns.push(new TextDecoder().decode(buf.subarray(a, b)));
      node.annotations = anns;
    }
    // (2) splice condensed placeholders in place: real leaves become siblings,
    //     inheriting the placeholder's branch_length; placeholder + its muts dropped
    for (const node of order) {
      if (node.id in this.condensed && node.parent) {
        const reals = this.condensed[node.id];
        const par = node.parent; const at = par.children.indexOf(node);
        const bl = node.branch_length;
        const newLeaves = reals.map(sn => { const lf = new Node(sn); lf.parent = par; lf.branch_length = bl; return lf; });
        par.children.splice(at, 1, ...newLeaves);
      }
    }
    // (3) number unlabeled internal nodes node_N in DFS pre-order (node_1=root)
    order = dfsPreorder(this.root);
    let ctr = 0;
    for (const n of order) if (n.id === null || n.id === '') { ctr++; n.id = `node_${ctr}`; }
    this._order = order;
    this._byid = new Map(order.map(n => [n.id, n]));
  }
  get_node(id) { return this._byid.get(id); }
  depth_first_expansion(nid) {
    if (nid == null) return this._order;
    return dfsPreorder(this._byid.get(nid));
  }
  get_leaves(nid) { return this.depth_first_expansion(nid).filter(n => n.is_leaf()); }
  get_leaves_ids(nid) { return this.get_leaves(nid).map(n => n.id); }
  get_annotations() {
    const out = {};
    for (const n of this._order) for (const a of n.annotations) if (a && !(a in out)) out[a] = n.id;
    return out;
  }
  rsearch(nid, includeSelf = false) {
    let n = this._byid.get(nid); const out = [];
    if (!includeSelf) n = n.parent;
    while (n) { out.push(n); n = n.parent; }
    return out;
  }
}

export { MATree, Node, CODE2BASE, BASE2CODE, readVarint, iterFields };
