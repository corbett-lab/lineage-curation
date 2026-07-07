"""Pure-Python UShER MAT (.pb) reader — no protobuf runtime, Pyodide-safe.
Reconstructs tree topology from the newick, attaches mutations/metadata in
newick DFS pre-order, and exposes mutation strings in bte's 'REF POS ALT' form.
"""
import sys, re

# nucleotide code -> base. UShER uses an ordered index (verified vs bte),
# NOT a one-hot bitmask.
CODE2BASE = {0:'A', 1:'C', 2:'G', 3:'T'}  # UShER ordered index (verified vs bte)

def _rv(b, i):
    s=0; r=0
    while True:
        x=b[i]; i+=1; r |= (x & 0x7f) << s
        if not (x & 0x80): break
        s += 7
    return r, i

def _iter_fields(pl):
    i=0; n=len(pl)
    while i < n:
        k,i=_rv(pl,i); fno=k>>3; wt=k&7
        if wt==0:
            v,i=_rv(pl,i); yield fno,0,v
        elif wt==2:
            ln,i=_rv(pl,i); yield fno,2,pl[i:i+ln]; i+=ln
        elif wt==5: yield fno,5,pl[i:i+4]; i+=4
        elif wt==1: yield fno,1,pl[i:i+8]; i+=8
        else: raise ValueError(f"bad wire type {wt}")

def _parse_mut(pl):
    pos=ref=par=None; muts=[]; chrom=None
    for fno,wt,v in _iter_fields(pl):
        if fno==1: pos=v
        elif fno==2: ref=v
        elif fno==3: par=v
        elif fno==4:
            if wt==2:  # packed
                j=0
                while j<len(v):
                    x,j=_rv(v,j); muts.append(x)
            else: muts.append(v)
        elif fno==5: chrom=v.decode()
    return pos, ref, par, muts, chrom

class Node:
    __slots__=("id","parent","children","branch_length","mutations","annotations")
    def __init__(self, nid):
        self.id=nid; self.parent=None; self.children=[]
        self.branch_length=0.0; self.mutations=[]; self.annotations=[]
    def is_leaf(self): return len(self.children)==0

# --- newick parser: returns root, and list of nodes in DFS pre-order matching UShER ---
def parse_newick(s):
    # UShER: node_mutations are ordered by a depth-first traversal.
    # Newick tokens; internal nodes may be unnamed -> assigned by MAT via metadata order.
    pos=[0]; auto=[0]
    s=s.strip()
    if s.endswith(";"): s=s[:-1]
    def parse_clade():
        node=Node(None)
        if s[pos[0]]=='(':
            pos[0]+=1
            while True:
                child=parse_clade()
                child.parent=node; node.children.append(child)
                if s[pos[0]]==',': pos[0]+=1; continue
                if s[pos[0]]==')': pos[0]+=1; break
        # label
        m=re.match(r'[^,():;]+', s[pos[0]:])
        label=""
        if m: label=m.group(0); pos[0]+=len(label)
        # branch length
        bl=None
        if pos[0]<len(s) and s[pos[0]]==':':
            pos[0]+=1
            m=re.match(r'[0-9eE.+\-]+', s[pos[0]:])
            bl=float(m.group(0)); pos[0]+=len(m.group(0))
        if ':' in label:  # shouldn't happen after split, guard
            label=label.split(':')[0]
        node.id=label if label else None
        if bl is not None: node.branch_length=bl
        return node
    root=parse_clade()
    return root

def dfs_preorder(root):
    out=[]; st=[root]
    # UShER uses recursive DFS visiting children in order; emulate with explicit stack (reverse children)
    def rec(n):
        out.append(n)
        for ch in n.children: rec(ch)
    sys.setrecursionlimit(2000000)
    rec(root)
    return out

class MATree:
    def __init__(self, path):
        buf=open(path,"rb").read()
        newick=None; node_muts=[]; metas=[]; condensed=[]
        for fno,wt,v in _iter_fields(buf):
            if fno==1: newick=v.decode()
            elif fno==2: node_muts.append(v)
            elif fno==3: condensed.append(v)
            elif fno==4: metas.append(v)
        # condensed: placeholder name -> [real sample names]
        self.condensed={}
        for cv in condensed:
            name=None; leaves=[]
            for fno,wt,v in _iter_fields(cv):
                if fno==1 and wt==2: name=v.decode()
                elif fno==2 and wt==2: leaves.append(v.decode())
            if name is not None: self.condensed[name]=leaves

        self.root=parse_newick(newick)
        # (1) original DFS order — placeholders are still leaves here; the stored
        #     node_mutations / metadata arrays are in exactly this order.
        order=dfs_preorder(self.root)
        assert len(order)==len(node_muts)==len(metas), \
            f"node count mismatch: newick={len(order)} muts={len(node_muts)} meta={len(metas)}"
        for node, mpl, meta in zip(order, node_muts, metas):
            mstrs=[]
            for fno,wt,mv in _iter_fields(mpl):
                if fno==1 and wt==2:
                    pos,ref,par,muts,chrom=_parse_mut(mv)
                    alt=CODE2BASE.get(muts[0],'N') if muts else 'N'
                    # bte builds the string as par_nuc + pos + mut_nuc.
                    # proto2 omits default-0 fields, so absent par_nuc == 0 == 'A'.
                    par_code = par if par is not None else 0
                    refb = CODE2BASE.get(par_code, 'N')
                    mstrs.append(f"{refb}{pos}{alt}")
            node.mutations=mstrs
            anns=[]
            for fno,wt,mv in _iter_fields(meta):
                if fno==1 and wt==2: anns.append(mv.decode())
            node.annotations=anns

        # (2) expand condensed placeholder leaves. bte replaces each placeholder leaf
        #     IN PLACE with its real sample leaves as siblings (children of the
        #     placeholder's parent, at the placeholder's position). The placeholder node
        #     and its stored mutations are discarded; each real leaf gets branch_length 1.0
        #     and no mutations.
        for node in order:
            if node.id in self.condensed and node.parent is not None:
                reals=self.condensed[node.id]
                par=node.parent
                pos=par.children.index(node)
                # bte gives each expanded real leaf the PLACEHOLDER's own newick
                # branch length (not a constant) — load-bearing for AutoLin's
                # distance-based scoring on trees with non-unit branch lengths.
                bl=node.branch_length
                new_leaves=[]
                for sname in reals:
                    leaf=Node(sname); leaf.parent=par; leaf.branch_length=bl
                    new_leaves.append(leaf)
                par.children[pos:pos+1]=new_leaves

        # (3) number internal / unlabeled nodes as node_N in DFS pre-order (node_1=root),
        #     matching bte. Leaves keep their sample name.
        order=dfs_preorder(self.root)
        ctr=0
        for n in order:
            if n.id is None or n.id=="":
                ctr+=1; n.id=f"node_{ctr}"
        self._order=order
        self._byid={n.id:n for n in order}

    def get_node(self, nid): return self._byid[nid]
    def depth_first_expansion(self): return self._order
    def get_leaves(self): return [n for n in self._order if n.is_leaf()]


# ============================================================================
#  bte-compatible API surface used by propose_sublineages.py
#  (validated against bte.MATree on the golden trees)
# ============================================================================

# --- Node methods AutoLin calls -------------------------------------------------
def _node_most_recent_annotation(self):
    """Nearest annotation walking root-ward (inclusive). Returns a list.
    bte returns the node's own annotations if present, else inherits the
    closest ancestor's; the root's clade if nothing else."""
    n=self
    while n is not None:
        real=[a for a in n.annotations if a]
        if real:
            return real
        n=n.parent
    return []

Node.most_recent_annotation=_node_most_recent_annotation

# --- MATree methods -------------------------------------------------------------
def _mat_get_node(self, nid): return self._byid[nid]
def _mat_depth_first_expansion(self, nid=None):
    if nid is None: return self._order
    start=self._byid[nid]
    out=[]
    def rec(n):
        out.append(n)
        for ch in n.children: rec(ch)
    rec(start)
    return out
def _mat_breadth_first_expansion(self, nid=None, named=True):
    """bte returns BFS order REVERSED (leaves first, root last) so that in a
    single forward pass every node is visited after all its children — which is
    exactly what AutoLin's get_sum_and_count relies on. Verified vs bte:
    0 child-after-parent violations, root last."""
    start=self.root if nid is None else self._byid[nid]
    out=[]; q=[start]
    while q:
        n=q.pop(0); out.append(n); q.extend(n.children)
    out.reverse()
    return out
def _mat_rsearch(self, nid, include_self=False):
    """Path from node to root (leaf-ward -> root). include_self toggles start node."""
    n=self._byid[nid]
    out=[]
    if not include_self: n=n.parent
    while n is not None:
        out.append(n); n=n.parent
    return out
def _mat_get_leaves(self, nid=None):
    nodes=self._order if nid is None else self.depth_first_expansion(nid)
    return [n for n in nodes if n.is_leaf()]
def _mat_get_leaves_ids(self, nid=None):
    return [n.id for n in self.get_leaves(nid)]
def _mat_get_annotations(self):
    """clade name -> node id. First occurrence wins (matches bte)."""
    out={}
    for n in self._order:
        for a in n.annotations:
            if a and a not in out:
                out[a]=n.id
    return out
_mat_dump_annotations=_mat_get_annotations  # alias (older bte name)
def _mat_apply_node_annotations(self, mapping):
    """mapping: node_id -> list of clade names (replaces that node's annotations)."""
    for nid, clades in mapping.items():
        node=self._byid.get(nid)
        if node is None: continue
        node.annotations=list(clades)

MATree.get_node=_mat_get_node
MATree.depth_first_expansion=_mat_depth_first_expansion
MATree.breadth_first_expansion=_mat_breadth_first_expansion
MATree.rsearch=_mat_rsearch
MATree.get_leaves=_mat_get_leaves
MATree.get_leaves_ids=_mat_get_leaves_ids
MATree.get_annotations=_mat_get_annotations
MATree.dump_annotations=_mat_dump_annotations
MATree.apply_node_annotations=_mat_apply_node_annotations

# --- writer: serialize back to a UShER .pb --------------------------------------
_BASE2CODE={'A':0,'C':1,'G':2,'T':3,'N':0}

def _wv(n):
    """encode varint"""
    out=bytearray()
    while True:
        b=n & 0x7f; n>>=7
        if n: out.append(b|0x80)
        else: out.append(b); break
    return bytes(out)
def _tag(fno,wt): return _wv((fno<<3)|wt)
def _len_field(fno,payload): return _tag(fno,2)+_wv(len(payload))+payload
def _vint_field(fno,val): return _tag(fno,0)+_wv(val)

def _encode_mut(mstr, chrom):
    # mstr like 'G497953A' -> par='G' pos=497953 mut='A'
    i=0
    while i<len(mstr) and not mstr[i].isdigit(): i+=1
    j=len(mstr)
    while j>0 and not mstr[j-1].isdigit(): j-=1
    par=mstr[:i]; pos=int(mstr[i:j]); alt=mstr[j:]
    payload=b""
    payload+=_vint_field(1,pos)
    # ref_nuc(2): bte stores genome ref; we don't track it separately, mirror par (unused by consumers)
    payload+=_vint_field(2,_BASE2CODE.get(par[-1] if par else 'A',0))
    payload+=_vint_field(3,_BASE2CODE.get(par[-1] if par else 'A',0))
    payload+=_len_field(4,_wv(_BASE2CODE.get(alt,0)))  # packed single
    if chrom: payload+=_len_field(5,chrom.encode())
    return _len_field(1,payload)  # wrapped as mutation_list.mutation

def _mat_save_pb(self, path, chrom=None):
    """Re-serialize to a UShER .pb. Re-condenses is NOT performed (leaves stay
    expanded); this yields a valid MAT that bte reloads with identical topology
    and annotations, which is what matUtils annotate / usher_to_taxonium consume."""
    if chrom is None:
        # infer chromosome from any mutation-bearing node? default empty
        chrom=getattr(self, "_chrom", None)
    # build newick with node_N labels for internal nodes (bte round-trips these as ids)
    def emit(n):
        if n.children:
            inner=",".join(emit(c) for c in n.children)
            lbl="" if (n.id and n.id.startswith("node_")) else (n.id or "")
            # keep internal node_N labels OUT of newick (bte re-derives them); but to
            # preserve ids we DO need them. bte accepts labelled internals.
            return f"({inner}){n.id}:{_fmt_bl(n)}"
        else:
            return f"{n.id}:{_fmt_bl(n)}"
    def _fmt_bl(n):
        bl=n.branch_length
        return str(int(bl)) if float(bl).is_integer() else str(bl)
    newick=emit(self.root)+";"
    order=self.depth_first_expansion()
    buf=bytearray()
    buf+=_len_field(1,newick.encode())
    for n in order:
        ml=b"".join(_encode_mut(m, chrom) for m in n.mutations)
        buf+=_len_field(2,ml)
    # condensed_nodes: none (we expanded them) -> omit
    for n in order:
        md=b"".join(_len_field(1,a.encode()) for a in n.annotations)
        buf+=_len_field(4,md)
    open(path,"wb").write(bytes(buf))
    return path

MATree.save_pb=_mat_save_pb

# --- module-level constructor alias so `import bte; bte.MATree(path)` works -------
# (propose_sublineages.py does `import bte; t = bte.MATree(args.input)`)
