// Unit test for the shared lineage-edit engine (src/ui/shared/lineageEditCore.cjs)
// — the single source of truth used by BOTH the Express backend and the in-browser
// worker. Runs the engine directly on a synthetic tree (no server, no browser), so
// a regression in merge / edit-root / the conflict-aware undo is caught in CI.
//
// Pure Node, no deps: `node src/ui/ts/test/lineage-edit.test.mjs` (or `npm test`).

import core from "../../shared/lineageEditCore.cjs";

const FIELD = "meta_annotation_1";

// A 3-level lineage hierarchy so merges can genuinely overlap (node ids are
// 1-indexed: the engine treats a falsy parent_id as "no parent", so a real tree
// never uses 0 for a child's parent):
//   A                         (root, node 1)
//   ├─ A.1                    (node 2)   tips 6,7
//   │   └─ A.1.1              (node 3)   tips 4,5
//   └─ (A tips 8,9 under root)
// Clade labels are derived by the engine's own rebuildCladeLabels from the tips.
function makeTree() {
  const N = (node_id, parent_id, is_tip, ann) => ({
    node_id,
    parent_id,
    is_tip,
    name: is_tip ? `s${node_id}` : `n${node_id}`,
    meta_annotation_1: is_tip ? ann : "",
    ...(is_tip ? {} : { clades: {} }),
  });
  const nodes = [
    N(1, 1, false), // root -> A
    N(2, 1, false), // -> A.1
    N(3, 2, false), // -> A.1.1
    N(4, 3, true, "A.1.1"),
    N(5, 3, true, "A.1.1"),
    N(6, 2, true, "A.1"),
    N(7, 2, true, "A.1"),
    N(8, 1, true, "A"),
    N(9, 1, true, "A"),
  ];
  const pd = { nodes };
  core.rebuildCladeLabels(pd, FIELD);
  return pd;
}

let passed = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
  } else {
    failures.push(`${name}${detail ? " — " + detail : ""}`);
  }
}
const byName = (lin) => new Map(lin.lineages.map((l) => [l.value, l]));
const eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ---- 1. lineage hierarchy ---------------------------------------------------
{
  core.resetEditHistory();
  const lin = core.getLineages(makeTree(), FIELD);
  const m = byName(lin);
  check("hierarchy: 3 unique lineages", lin.uniqueLineages === 3, `got ${lin.uniqueLineages}`);
  check("hierarchy: A is root", m.get("A")?.parent === null && m.get("A")?.count === 6);
  check("hierarchy: A.1 parent=A", m.get("A.1")?.parent === "A" && m.get("A.1")?.count === 4);
  check("hierarchy: A.1.1 parent=A.1", m.get("A.1.1")?.parent === "A.1" && m.get("A.1.1")?.count === 2);
}

// ---- 2. merge + single undo round-trip (disjoint => no cascade) --------------
{
  core.resetEditHistory();
  const pd = makeTree();
  const merged = core.mergeLineage(pd, "A.1.1", FIELD);
  check("merge: A.1.1 -> A.1", merged.success && merged.parentLineage === "A.1" && merged.mergedCount === 2, JSON.stringify(merged));
  check("merge: 2 lineages remain", core.getLineages(pd, FIELD).uniqueLineages === 2);
  check("undo-preview: no cascade", eqArr(core.undoPreview(0).wouldUndo, [0]));
  const u = core.undoEdit(pd, 0);
  check("undo: removed 1", u.success && u.removedCount === 1);
  check("undo: round-trips to 3", core.getLineages(pd, FIELD).uniqueLineages === 3);
}

// ---- 3. conflict-aware undo cascade -----------------------------------------
{
  core.resetEditHistory();
  const pd = makeTree();
  core.mergeLineage(pd, "A.1.1", FIELD); // edit 0, snapshot {3,4}
  core.mergeLineage(pd, "A.1", FIELD); // edit 1, snapshot {3,4,5,6} — overlaps edit 0
  check("cascade: 2 edits recorded", core.getEditHistory().length === 2);
  check("cascade: undo-preview(0) pulls in the overlapping edit", eqArr(core.undoPreview(0).wouldUndo, [0, 1]));
  const u = core.undoEdit(pd, 0);
  check("cascade: undo removed both", u.success && u.removedCount === 2 && u.remainingEdits === 0);
  check("cascade: full round-trip to 3", core.getLineages(pd, FIELD).uniqueLineages === 3);
}

// ---- 4. edit-lineage-root smoke + undo round-trip ---------------------------
{
  core.resetEditHistory();
  const pd = makeTree();
  const er = core.editLineageRoot(pd, "A.1", 3, FIELD);
  check("edit-root: succeeds + records an edit", er.success === true && core.getEditHistory().length === 1, JSON.stringify(er));
  core.undoEdit(pd, 0);
  check("edit-root: undo round-trips to 3", core.getLineages(pd, FIELD).uniqueLineages === 3);
}

// ---- 5. error handling ------------------------------------------------------
{
  core.resetEditHistory();
  const pd = makeTree();
  check("error: missing lineageName", !!core.mergeLineage(pd, "", FIELD).error);
  check("error: unknown lineage has no parent", !!core.mergeLineage(pd, "NOPE", FIELD).error);
  check("error: cannot merge the root lineage", !!core.mergeLineage(pd, "A", FIELD).error);
  check("error: edit-root missing rootNodeId", !!core.editLineageRoot(pd, "A.1", undefined, FIELD).error);
  check("error: edit-root unknown node", /not found/.test(core.editLineageRoot(pd, "A.1", 999, FIELD).error || ""));
  check("error: undo with empty history", !!core.undoEdit(pd, 0).error);
}

// ---- report -----------------------------------------------------------------
if (failures.length === 0) {
  console.log(`✓ lineage-edit engine: all ${passed} checks passed`);
} else {
  console.error(`✗ lineage-edit engine: ${failures.length} failed (${passed} passed):`);
  for (const f of failures) console.error("    - " + f);
  process.exitCode = 1;
}
