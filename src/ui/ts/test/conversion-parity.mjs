// Conversion-layer parity test — the WASM build's JS ports of the native tools
// must not drift from what the server-mode pipeline (matUtils / usher_to_taxonium)
// produces. Server mode shells out to native binaries; WASM mode runs these hand-
// written ports (ts/src/{matpb,matUtils,usherToTaxonium}.js) in the browser. This
// is the CI guard that keeps them equivalent.
//
// Two checks on the small golden tree (src/autolin/XFG.pangoonly.pb, 7288 samples):
//
//   1. summaryClades  ==  native `matUtils summary -C`   (byte-exact, golden below)
//   2. toTaxonium node records match a committed structural hash (deterministic;
//      excludes the header's date_created + layout `y`, snapshots everything else:
//      topology, mutations, clade annotations, tip counts, rounded x_dist).
//
// Pure Node — the ports have no npm deps, so CI needs only `node`, no install.
//
// Regenerate the goldens when the ports intentionally change (and you've confirmed
// the new output still matches native):
//   * summary golden (needs the linolium image with native matUtils):
//       docker run --rm -v "$PWD/src/autolin/XFG.pangoonly.pb":/d.pb linolium \
//         bash -lc 'source /opt/conda/etc/profile.d/conda.sh && conda activate taxalin \
//           && cd /tmp && matUtils summary -i /d.pb -C sc.tsv >/dev/null 2>&1 && cat sc.tsv' \
//         | sort | gzip -nc > src/ui/ts/test/golden/xfg.summary.sorted.tsv.gz
//   * toTaxonium hash:  UPDATE_HASH=1 node src/ui/ts/test/conversion-parity.mjs
//     (prints the new hash to paste into EXPECTED_TAXONIUM_HASH below)

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { MATree } from '../src/matpb.js';
import { summaryClades } from '../src/matUtils.js';
import { toTaxonium } from '../src/usherToTaxonium.js';

const EXPECTED_TAXONIUM_HASH =
  'b8da536bc3c223d1f359931230435491de97959ac8b977a99fca7d8b81e0aed0';

const url = (rel) => new URL(rel, import.meta.url);
const pbPath = url('../../../../src/autolin/XFG.pangoonly.pb');
const goldenPath = url('./golden/xfg.summary.sorted.tsv.gz');

const sha = (s) => createHash('sha256').update(s).digest('hex');
const fail = (msg) => { console.error(`\n✗ FAIL: ${msg}\n`); process.exitCode = 1; };

const pb = new Uint8Array(readFileSync(pbPath));

// ---- check 1: summaryClades == native matUtils summary -C -------------------
const summary = summaryClades(new MATree(pb));
const jsSorted = summary.trim().split('\n').sort();
const goldenSorted = gunzipSync(readFileSync(goldenPath)).toString('utf8').trim().split('\n').sort();

if (jsSorted.length !== goldenSorted.length) {
  fail(`summaryClades row count ${jsSorted.length} != native golden ${goldenSorted.length}`);
} else {
  let firstDiff = -1;
  for (let i = 0; i < jsSorted.length; i++) if (jsSorted[i] !== goldenSorted[i]) { firstDiff = i; break; }
  if (firstDiff === -1) {
    console.log(`✓ summaryClades == native matUtils summary -C  (${jsSorted.length} rows, byte-exact)`);
  } else {
    fail(`summaryClades differs from native golden at sorted line ${firstDiff}:\n` +
      `    JS    : ${jsSorted[firstDiff]}\n    native: ${goldenSorted[firstDiff]}`);
  }
}

// ---- check 2: toTaxonium structural snapshot (deterministic) -----------------
function cladeMapFrom(tsv) {
  const m = new Map();
  const lines = tsv.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const t = lines[i].indexOf('\t');
    m.set(lines[i].slice(0, t), lines[i].slice(t + 1));
  }
  return m;
}
// everything meaningful EXCEPT the header (its date_created changes daily) and the
// layout `y` float; x_dist is already rounded to 1e5 inside the port.
function project(records) {
  return records.slice(1).map((r) =>
    [r.name, r.is_tip ? 1 : 0, r.meta_annotation_1, r.clades.pango, r.num_tips,
     r.parent_id, r.node_id, r.x_dist, r.mutations.join(',')].join('\t')
  ).join('\n');
}

const records = toTaxonium(new MATree(pb), cladeMapFrom(summary));
const tips = records.slice(1).filter((r) => r.is_tip).length;
const hash = sha(project(records));

if (process.env.UPDATE_HASH) {
  console.log(`\nUPDATE_HASH: new toTaxonium hash =\n  ${hash}\n(paste into EXPECTED_TAXONIUM_HASH)`);
} else if (hash === EXPECTED_TAXONIUM_HASH) {
  console.log(`✓ toTaxonium structural snapshot matches  (${records.length - 1} nodes, ${tips} tips)`);
} else {
  fail(`toTaxonium structural hash changed:\n    got     : ${hash}\n    expected: ${EXPECTED_TAXONIUM_HASH}\n` +
    `    If this change is intentional AND still matches native, regenerate with UPDATE_HASH=1.`);
}

// ---- sanity ------------------------------------------------------------------
if (tips !== jsSorted.length - 1) fail(`tip count ${tips} != summary sample count ${jsSorted.length - 1}`);

if (!process.exitCode) console.log('\n★ conversion parity OK — JS ports match the native pipeline.\n');
