"""
translate.py — replacement for bte.MATree.translate()

Parses any GTF + FASTA reference and computes amino acid changes
across a BTE mutation-annotated tree, returning results per node.

Usage:
    from translate import translate_tree
    import bte

    tree = bte.MATree("your_tree.pb")
    results = translate_tree(tree, "your_annotation.gtf", "your_reference.fasta")

    # results is a dict: {node_id: [AAChange, ...]}
    # each AAChange has .gene, .ref_aa, .alt_aa, .position, .ref_codon, .alt_codon
    # and methods .is_synonymous(), .is_nonsense(), .aa_string()
"""

from dataclasses import dataclass
from typing import Optional
from collections import defaultdict


# ---------------------------------------------------------------------------
# Amino acid table
# ---------------------------------------------------------------------------

CODON_TABLE = {
    'TTT': 'F', 'TTC': 'F', 'TTA': 'L', 'TTG': 'L',
    'CTT': 'L', 'CTC': 'L', 'CTA': 'L', 'CTG': 'L',
    'ATT': 'I', 'ATC': 'I', 'ATA': 'I', 'ATG': 'M',
    'GTT': 'V', 'GTC': 'V', 'GTA': 'V', 'GTG': 'V',
    'TCT': 'S', 'TCC': 'S', 'TCA': 'S', 'TCG': 'S',
    'CCT': 'P', 'CCC': 'P', 'CCA': 'P', 'CCG': 'P',
    'ACT': 'T', 'ACC': 'T', 'ACA': 'T', 'ACG': 'T',
    'GCT': 'A', 'GCC': 'A', 'GCA': 'A', 'GCG': 'A',
    'TAT': 'Y', 'TAC': 'Y', 'TAA': '*', 'TAG': '*',
    'CAT': 'H', 'CAC': 'H', 'CAA': 'Q', 'CAG': 'Q',
    'AAT': 'N', 'AAC': 'N', 'AAA': 'K', 'AAG': 'K',
    'GAT': 'D', 'GAC': 'D', 'GAA': 'E', 'GAG': 'E',
    'TGT': 'C', 'TGC': 'C', 'TGA': '*', 'TGG': 'W',
    'CGT': 'R', 'CGC': 'R', 'CGA': 'R', 'CGG': 'R',
    'AGT': 'S', 'AGC': 'S', 'AGA': 'R', 'AGG': 'R',
    'GGT': 'G', 'GGC': 'G', 'GGA': 'G', 'GGG': 'G',
}

# Amino acid physicochemical groups for conservative/radical classification
#i dont have a cite for this rn but i got it from here https://www.khanacademy.org/test-prep/mcat/biomolecules/amino-acids-and-proteins1/a/amino-acid-structure-and-classifications
AA_GROUPS = {
    'nonpolar':    set('GAVILMPFW'),
    'polar':       set('STCYNQ'),
    'positive':    set('KRH'),
    'negative':    set('DE'),
}

COMPLEMENT = str.maketrans('ACGT', 'TGCA')

def _aa_group(aa: str) -> set:
    return {g for g, members in AA_GROUPS.items() if aa in members}

def translate_codon(codon: str) -> Optional[str]:
    codon = codon.upper()
    if len(codon) != 3 or any(b not in 'ACGT' for b in codon):
        return None
    return CODON_TABLE.get(codon)


# ---------------------------------------------------------------------------
# AAChange result class
# ---------------------------------------------------------------------------

@dataclass
class AAChange:
    gene: str
    ref_aa: str
    alt_aa: str
    position: int       # 1-based amino acid position within the gene
    ref_codon: str
    alt_codon: str
    nt_position: int    # 1-based nucleotide position in genome
    ref_nt: str
    alt_nt: str
    strand: str = '+'

    def aa_string(self) -> str:
        """e.g. 'S:D614G'"""
        return f"{self.gene}:{self.ref_aa}{self.position}{self.alt_aa}"

    def is_synonymous(self) -> bool:
        return self.ref_aa == self.alt_aa

    def is_nonsense(self) -> bool:
        """Alt is a stop codon (premature termination)."""
        return self.alt_aa == '*' and self.ref_aa != '*'

    def is_conservative(self) -> bool:
        """Ref and alt amino acids share at least one physicochemical group."""
        if self.is_synonymous():
            return True
        return bool(_aa_group(self.ref_aa) & _aa_group(self.alt_aa))

    def is_radical(self) -> bool:
        return not self.is_synonymous() and not self.is_conservative()

    def mutation_type(self) -> str:
        if self.is_synonymous():
            return 'synonymous'
        if self.is_nonsense():
            return 'nonsense'
        if self.is_conservative():
            return 'conservative'
        return 'radical'

    def __repr__(self):
        return (f"AAChange({self.aa_string()} [{self.mutation_type()}] "
                f"codon {self.ref_codon}>{self.alt_codon})")


# ---------------------------------------------------------------------------
# GTF parser
# ---------------------------------------------------------------------------

def parse_gtf(gtf_path: str) -> dict:
    """
    Parse a GTF file and return CDS intervals grouped by gene.

    Returns:
        dict: {
            gene_id: {
                'name': str,            # gene_name if present, else gene_id
                'strand': '+' or '-',
                'chrom': str,
                'cds': [(start, end), ...]  # 1-based, inclusive, sorted
            }
        }
    """
    genes = {}

    with open(gtf_path) as f:
        for line in f:
            if line.startswith('#'):
                continue
            line = line.rstrip('\n')
            parts = line.split('\t')
            if len(parts) < 9:
                continue

            chrom, source, feature, start, end, score, strand, frame, attributes = parts
            if feature != 'CDS':
                continue

            start, end = int(start), int(end)
            attrs = _parse_attributes(attributes)

            # gene_id: try gene_id first, fall back to transcript_id
            gene_id = attrs.get('gene_id') or attrs.get('transcript_id')
            if not gene_id:
                continue

            # human-readable name: prefer gene_name
            gene_name = attrs.get('gene_name') or gene_id

            if gene_id not in genes:
                genes[gene_id] = {
                    'name': gene_name,
                    'strand': strand,
                    'chrom': chrom,
                    'cds': []
                }

            genes[gene_id]['cds'].append((start, end))

    # Sort CDS intervals by start position and deduplicate
    for gene_id, gene in genes.items():
        gene['cds'] = sorted(set(gene['cds']), key=lambda x: x[0])

    # Detect and collapse overlapping CDS intervals within a gene.
    # This handles cases like ORF1ab in SARS-CoV-2, where frameshifting
    # produces multiple overlapping CDS entries in the GTF. We collapse
    # them to a single spanning interval and warn the user.
    for gene_id, gene in genes.items():
        collapsed, changed = _collapse_overlapping_cds(gene['cds'])
        if changed:
            gene_name = gene['name']
            print(
                f"WARNING: {gene_name} has overlapping CDS intervals in the GTF "
                f"and will be treated as a single unified CDS span for purposes of "
                f"translation. ORF1a and ORF1b are treated as a unified ORF1ab for "
                f"purposes of haplotype identification due to complexities with "
                f"redundant counting and translation implementation."
            )
            gene['cds'] = collapsed

    return genes


def _collapse_overlapping_cds(intervals: list) -> tuple:
    """
    Detect overlapping intervals and collapse to a single spanning interval.
    Returns (collapsed_intervals, was_changed).
    Non-overlapping multi-exon genes are left untouched.
    """
    if len(intervals) <= 1:
        return intervals, False

    has_overlap = False
    for i in range(len(intervals)):
        for j in range(i + 1, len(intervals)):
            a_start, a_end = intervals[i]
            b_start, b_end = intervals[j]
            if a_start <= b_end and b_start <= a_end:
                has_overlap = True
                break
        if has_overlap:
            break

    if not has_overlap:
        return intervals, False

    overall_start = min(s for s, e in intervals)
    overall_end = max(e for s, e in intervals)
    return [(overall_start, overall_end)], True


def _parse_attributes(attr_string: str) -> dict:
    """Parse GTF attribute column into a dict, handling both quoted and unquoted values."""
    attrs = {}
    for part in attr_string.split(';'):
        part = part.strip()
        if not part:
            continue
        # Split on first whitespace
        tokens = part.split(None, 1)
        if len(tokens) == 2:
            key, val = tokens
            val = val.strip().strip('"')
            attrs[key] = val
        elif len(tokens) == 1:
            attrs[tokens[0]] = ''
    return attrs


# ---------------------------------------------------------------------------
# FASTA parser
# ---------------------------------------------------------------------------

def parse_fasta(fasta_path: str) -> dict:
    """
    Parse a FASTA file. Returns dict of {chrom: sequence_string} (uppercase).
    """
    sequences = {}
    current_chrom = None
    current_seq = []

    with open(fasta_path) as f:
        for line in f:
            line = line.rstrip('\n')
            if line.startswith('>'):
                if current_chrom is not None:
                    sequences[current_chrom] = ''.join(current_seq).upper()
                # Take only the first word of the header as chrom name
                current_chrom = line[1:].split()[0]
                current_seq = []
            else:
                current_seq.append(line)

    if current_chrom is not None:
        sequences[current_chrom] = ''.join(current_seq).upper()

    return sequences


# ---------------------------------------------------------------------------
# CDS coordinate index
# ---------------------------------------------------------------------------

def build_position_index(genes: dict) -> dict:
    """
    Build a dict mapping genome position -> list of (gene_id, aa_position, codon_start)
    for fast lookup during mutation scanning.

    aa_position is 1-based amino acid position.
    codon_start is the 1-based genome position of the first base of that codon.
    """
    index = {}  # {(chrom, nt_pos): [(gene_id, aa_pos, codon_start_idx, nt_positions), ...]}

    for gene_id, gene in genes.items():
        chrom = gene['chrom']
        strand = gene['strand']
        cds_intervals = gene['cds']

        # Build ordered list of all CDS nucleotide positions
        nt_positions = []
        for (start, end) in cds_intervals:
            for pos in range(start, end + 1):
                nt_positions.append(pos)

        if strand == '-':
            nt_positions = list(reversed(nt_positions))

        for i, pos in enumerate(nt_positions):
            aa_pos = i // 3 + 1           # 1-based AA position
            codon_offset = i % 3          # position within codon (0,1,2)
            codon_start_idx = i - codon_offset
            # genome position of first base of this codon
            codon_genome_start = nt_positions[codon_start_idx]

            key = (chrom, pos)
            if key not in index:
                index[key] = []
            index[key].append((gene_id, aa_pos, codon_start_idx, nt_positions))

    return index


# ---------------------------------------------------------------------------
# Codon extraction from a mutable sequence state
# ---------------------------------------------------------------------------

def get_codon(nt_positions: list, codon_start_idx: int, seq_state: dict, chrom: str, ref_seq: str, strand: str = '+') -> str:
    codon = []
    for i in range(codon_start_idx, codon_start_idx + 3):
        if i >= len(nt_positions):
            return None
        pos = nt_positions[i]
        key = (chrom, pos)
        if key in seq_state:
            base = seq_state[key]
        else:
            base = ref_seq[pos - 1]
        if strand == '-':
            base = base.translate(COMPLEMENT)
        codon.append(base)
    return ''.join(codon)


# ---------------------------------------------------------------------------
# Mutation string parser
# ---------------------------------------------------------------------------

def parse_mutation(mut_string: str, default_chrom: str = None):
    """
    Parse a BTE mutation string.
    Formats seen:
      'A1234T'           -> no chrom prefix (use default_chrom)
      'NC_045512.2:A1234T'
    Returns (chrom, ref, pos, alt) or None if unparseable.
    """
    import re

    # Try chrom:refposalt
    m = re.match(r'^(.+):([A-Za-z-])(\d+)([A-Za-z-])$', mut_string)
    if m:
        chrom, ref, pos, alt = m.group(1), m.group(2), int(m.group(3)), m.group(4)
        return chrom, ref.upper(), pos, alt.upper()

    # Try bare refposalt
    m = re.match(r'^([A-Za-z-])(\d+)([A-Za-z-])$', mut_string)
    if m:
        ref, pos, alt = m.group(1), int(m.group(2)), m.group(3)
        return default_chrom, ref.upper(), pos, alt.upper()

    return None


# ---------------------------------------------------------------------------
# Main translation function
# ---------------------------------------------------------------------------

def translate_tree(tree, gtf_path: str, fasta_path: str, default_chrom: str = None, debug_multi_codon: bool = False) -> dict:
    """
    Replacement for bte.MATree.translate().

    Traverses the tree in depth-first preorder (root to tips), propagating
    the accumulated sequence state as mutations are encountered, and computes
    amino acid changes for any mutation that falls within a CDS.

    Args:
        tree:           A bte.MATree object
        gtf_path:       Path to a GTF annotation file
        fasta_path:     Path to a reference FASTA file
        default_chrom:  Chromosome name to assume for mutations without a
                        chrom prefix. If None, inferred from the FASTA.
        debug_multi_codon: If True, print diagnostic info about multi-mutation codons

    Returns:
        dict: {node_id: [AAChange, ...]}
              Only nodes with at least one coding mutation are included.
    """
    print("Parsing GTF...")
    genes = parse_gtf(gtf_path)
    
    print(f"Found {len(genes)} genes with CDS annotation")
    
    print("Parsing FASTA...")
    ref_seqs = parse_fasta(fasta_path)
    print(f"  Found {len(ref_seqs)} sequences: {list(ref_seqs.keys())}")
    
    if default_chrom is None:
        if len(ref_seqs) == 1:
            default_chrom = list(ref_seqs.keys())[0]
        else:
            default_chrom = list(ref_seqs.keys())[0]
            print(f"  Multiple chromosomes found, defaulting to '{default_chrom}'")
    
    
    print("Building position index...")
    position_index = build_position_index(genes)
    print(f"  Indexed {len(position_index)} CDS nucleotide positions")
    
    print("Traversing tree...")
    results = {}
    
    # depth_first_expansion returns nodes in preorder (root first),
    # so parent seq_state is always processed before children
    nodes = tree.depth_first_expansion()
    
    # seq_state_map: {node_id: {(chrom, pos): alt_base}}
    # tracks accumulated mutations from root to each node
    seq_state_map = {}

    root = nodes[0]
    seq_state_map[root.id] = {}

    # Track multi-codon statistics
    multi_codon_count = 0
    multi_codon_mutations = 0
    
    for node in nodes:
        # Get parent's accumulated state
        if node.id == root.id:
            parent_state = {}
        else:
            parent_id = node.parent.id if node.parent else root.id
            parent_state = seq_state_map.get(parent_id, {})

        # Copy parent state and prepare to apply this node's mutations
        node_state = dict(parent_state)
        node_aa_changes = []

        # Group mutations by which codon they affect
        codon_mutation_groups = defaultdict(list)
        
        for mut_str in node.mutations:
            parsed = parse_mutation(mut_str, default_chrom)
            if parsed is None:
                continue
            chrom, ref_nt, pos, alt_nt = parsed

            # Check if this position is in any CDS
            entries = position_index.get((chrom, pos), [])
            for (gene_id, aa_pos, codon_start_idx, nt_positions) in entries:
                codon_key = (gene_id, aa_pos, codon_start_idx, tuple(nt_positions), chrom)
                codon_mutation_groups[codon_key].append((mut_str, chrom, ref_nt, pos, alt_nt))

        # Process each codon that has mutations
        for codon_key, mutations_in_codon in codon_mutation_groups.items():
            gene_id, aa_pos, codon_start_idx, nt_positions, chrom = codon_key
            nt_positions = list(nt_positions)  # Convert back from tuple
            gene = genes[gene_id]
            strand = gene['strand']
            ref_seq = ref_seqs.get(chrom, ref_seqs.get(default_chrom, ''))

            # Track multi-mutation codons
            if len(mutations_in_codon) > 1:
                multi_codon_count += 1
                multi_codon_mutations += len(mutations_in_codon)
                if debug_multi_codon:
                    gene_name = gene['name']
                    mut_strs = [m[0] for m in mutations_in_codon]
                    print(f"Multi-mutation codon: {node.id} gene={gene_name} aa_pos={aa_pos} muts={mut_strs}")

            # Get reference codon (with parent's mutations only)
            ref_codon = get_codon(nt_positions, codon_start_idx, parent_state, chrom, ref_seq, strand)
            
            # Apply ALL mutations in this codon to node_state
            temp_state = dict(node_state)
            for mut_str, chrom, ref_nt, pos, alt_nt in mutations_in_codon:
                temp_state[(chrom, pos)] = alt_nt
            
            # Get alt codon with ALL mutations applied
            alt_codon = get_codon(nt_positions, codon_start_idx, temp_state, chrom, ref_seq, strand)
            
            if ref_codon is None or alt_codon is None:
                continue

            ref_aa = translate_codon(ref_codon)
            alt_aa = translate_codon(alt_codon)

            if ref_aa is None or alt_aa is None:
                continue

            # Only create ONE AAChange per codon, even if multiple mutations
            # Use the first mutation's position as representative
            first_mut = mutations_in_codon[0]
            _, _, ref_nt, pos, alt_nt = first_mut

            change = AAChange(
                gene=gene['name'],
                ref_aa=ref_aa,
                alt_aa=alt_aa,
                position=aa_pos,
                ref_codon=ref_codon,
                alt_codon=alt_codon,
                nt_position=pos,
                ref_nt=ref_nt,
                alt_nt=alt_nt,
                strand=strand
            )
            node_aa_changes.append(change)

        # Apply ALL mutations to node_state (not just coding ones)
        for mut_str in node.mutations:
            parsed = parse_mutation(mut_str, default_chrom)
            if parsed is None:
                continue
            chrom, ref_nt, pos, alt_nt = parsed
            node_state[(chrom, pos)] = alt_nt

        if node_aa_changes:
            # Deduplicate - overlapping genes can create duplicate AAChanges
            seen = set()
            unique_changes = []
            for change in node_aa_changes:
                key = (change.gene, change.position, change.ref_aa, change.alt_aa)
                if key not in seen:
                    seen.add(key)
                    unique_changes.append(change)
            
            if len(node_aa_changes) != len(unique_changes):
                print(f"Node {node.id}: {len(node_aa_changes)} changes -> {len(unique_changes)} unique")
            
            results[node.id] = unique_changes

        # Store this node's state for its children
        seq_state_map[node.id] = node_state

        # Clean up states for nodes whose children are all done
        # (optional memory optimization for very large trees)
        if node.is_leaf():
            seq_state_map.pop(node.id, None)

    print(f"Done. Found coding mutations in {len(results)} nodes.")
    print(f"Multi-mutation codons: {multi_codon_count} codons, {multi_codon_mutations} total mutations")
    
    return results


# ---------------------------------------------------------------------------
# Convenience summary functions
# ---------------------------------------------------------------------------

def filter_by_type(results: dict, mutation_type: str) -> dict:
    """
    Filter translate_tree results to a specific mutation type.
    mutation_type: 'synonymous', 'nonsense', 'conservative', 'radical'
    """
    return {
        node_id: [c for c in changes if c.mutation_type() == mutation_type]
        for node_id, changes in results.items()
        if any(c.mutation_type() == mutation_type for c in changes)
    }


def filter_by_gene(results: dict, gene_name: str) -> dict:
    """Filter translate_tree results to a specific gene."""
    return {
        node_id: [c for c in changes if c.gene == gene_name]
        for node_id, changes in results.items()
        if any(c.gene == gene_name for c in changes)
    }


def summarize(results: dict) -> dict:
    """
    Return counts of each mutation type across all nodes.
    """
    counts = {'synonymous': 0, 'nonsense': 0, 'conservative': 0, 'radical': 0}
    for changes in results.values():
        for c in changes:
            counts[c.mutation_type()] += 1
    return counts

def summarize_by_node(results: dict) -> dict:
    """
    Return counts of each mutation type for each node.
    Returns: {node_id: {'synonymous': X, 'nonsense': X, 'conservative': X, 'radical': X}}
    """
    node_summaries = {}
    for node_id, changes in results.items():
        counts = {'synonymous': 0, 'nonsense': 0, 'conservative': 0, 'radical': 0}
        for c in changes:
            counts[c.mutation_type()] += 1
        node_summaries[node_id] = counts
    return node_summaries


def to_dataframe(results: dict):
    """
    Convert results to a pandas DataFrame (requires pandas).
    Columns: node_id, gene, aa_change, mutation_type, nt_position,
             ref_nt, alt_nt, ref_codon, alt_codon, ref_aa, alt_aa, aa_position
    """
    import pandas as pd
    rows = []
    for node_id, changes in results.items():
        for c in changes:
            rows.append({
                'node_id': node_id,
                'gene': c.gene,
                'aa_change': c.aa_string(),
                'mutation_type': c.mutation_type(),
                'nt_position': c.nt_position,
                'ref_nt': c.ref_nt,
                'alt_nt': c.alt_nt,
                'ref_codon': c.ref_codon,
                'alt_codon': c.alt_codon,
                'ref_aa': c.ref_aa,
                'alt_aa': c.alt_aa,
                'aa_position': c.position,
            })
    return pd.DataFrame(rows)