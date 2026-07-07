// Conversion web worker: takes an AutoLin-annotated MAT .pb and produces the
// Taxonium jsonl the viewer consumes — replacing the backend's
// `matUtils summary` + `convert_autolinpb_totax.py` + `usher_to_taxonium` chain
// with the pure-JS Step-4 ports (byte-exact to the native pipeline on 3 trees).
//
// Protocol:
//   in : {type:'convert', pb:ArrayBuffer}
//   out: {type:'result', jsonl:string, summaryTsv:string, nNodes}
//   out: {type:'error', message}
import { MATree } from '../ts/src/matpb.js';
import { summaryClades } from '../ts/src/matUtils.js';
import { toTaxonium } from '../ts/src/usherToTaxonium.js';

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type !== 'convert') return;
  try {
    const t = new MATree(new Uint8Array(msg.pb));

    // matUtils summary -C : per-sample clade table (also the meta the converter joins)
    const summaryTsv = summaryClades(t);
    const cladeMap = new Map();
    for (const line of summaryTsv.trim().split('\n').slice(1)) {
      const [s, c] = line.split('\t');
      cladeMap.set(s, c);
    }

    // usher_to_taxonium --clade_types pango
    const records = toTaxonium(t, cladeMap);
    const jsonl = records.map((r) => JSON.stringify(r)).join('\n') + '\n';

    self.postMessage({ type: 'result', jsonl, summaryTsv, nNodes: records.length });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.stack || err) });
  }
};
