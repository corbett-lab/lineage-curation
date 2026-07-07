// AutoLin web worker: runs the UNMODIFIED autolin/propose_sublineages.py on the
// pure-Python bte shim inside Pyodide, entirely in the browser. No backend, no
// Docker, no compiled bte. Proven byte-exact to the native pipeline on 3 golden
// trees (xfg/mtb/subtree), peak ~280 MB for a 36k-sample / 59k-node tree.
//
// Protocol (postMessage):
//   in : {type:'init'}                      -> {type:'ready'}
//   in : {type:'run', pb:ArrayBuffer, params:{minsamples,distinction,cutoff,floor,recursive,clear,verbose}}
//   out: {type:'log', message}              (streamed during the run)
//   out: {type:'stage', stage}              ('loading'|'proposing'|'done')
//   out: {type:'result', pb:ArrayBuffer, dump:string, labels:string, nLineages}
//   out: {type:'error', message}
//
// Assets (co-located, fetched once): pyodide runtime (CDN or self-hosted),
// bte_shim.py, propose_sublineages.py, pango_aliasor/aliasor.py, alias_key.json.

const PYODIDE_INDEX = self.PYODIDE_INDEX_URL || 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/';
// Root-absolute (NOT './…') — a worker chunk lives under /assets/, so a relative
// base would resolve against /assets/ and 404 into the SPA fallback (index.html).
// Override AUTOLIN_ASSET_BASE if the app is served under a sub-path.
const ASSET_BASE = self.AUTOLIN_ASSET_BASE || '/autolin-assets/';

let pyodide = null;

async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`); return r.text(); }

async function initPyodide() {
  if (pyodide) return pyodide;
  post({ type: 'stage', stage: 'loading' });
  importScripts(PYODIDE_INDEX + 'pyodide.js');
  pyodide = await self.loadPyodide({ indexURL: PYODIDE_INDEX });

  // stage python assets into the virtual FS
  const FS = pyodide.FS;
  FS.mkdir('/autolin');
  FS.mkdir('/autolin/pango_aliasor');
  const [shim, propose, aliasor, aliasKey] = await Promise.all([
    fetchText(ASSET_BASE + 'bte_shim.py'),
    fetchText(ASSET_BASE + 'propose_sublineages.py'),
    fetchText(ASSET_BASE + 'pango_aliasor/aliasor.py'),
    fetchText(ASSET_BASE + 'alias_key.json'),
  ]);
  FS.writeFile('/autolin/bte_shim.py', shim);
  FS.writeFile('/autolin/propose_sublineages.py', propose);
  FS.writeFile('/autolin/pango_aliasor/__init__.py', '');
  FS.writeFile('/autolin/pango_aliasor/aliasor.py', aliasor);
  FS.writeFile('/autolin/alias_key.json', aliasKey);

  // route python stdout/stderr to the log channel
  pyodide.setStdout({ batched: (s) => post({ type: 'log', message: s }) });
  pyodide.setStderr({ batched: (s) => post({ type: 'log', message: s }) });
  return pyodide;
}

async function run(pbBuffer, params = {}) {
  const py = await initPyodide();
  const FS = py.FS;
  FS.writeFile('/autolin/input.pb', new Uint8Array(pbBuffer));

  const args = ['-i', '/autolin/input.pb', '-o', '/autolin/out.pb',
    '-m', String(params.minsamples ?? 10),
    '-t', String(params.distinction ?? 1),
    '-u', String(params.cutoff ?? 0.95),
    '-f', String(params.floor ?? 0),
    '-d', '/autolin/dump.tsv', '-l', '/autolin/labels.tsv'];
  if (params.recursive) args.push('-r');
  if (params.verbose) args.push('-v');
  if (params.clear) args.push('-c');

  post({ type: 'stage', stage: 'proposing' });
  py.globals.set('ARGV', py.toPy(args));
  await py.runPythonAsync(`
import sys, importlib.util, runpy
sys.path.insert(0, '/autolin')

# pango_aliasor must read the bundled alias_key.json (no network in the worker)
import pango_aliasor.aliasor as _al
_orig = _al.Aliasor.__init__
def _patched(self, alias_file=None):
    _orig(self, alias_file or '/autolin/alias_key.json')
_al.Aliasor.__init__ = _patched

# shadow compiled bte with the pure-Python shim
spec = importlib.util.spec_from_file_location('bte', '/autolin/bte_shim.py')
_bte = importlib.util.module_from_spec(spec)
spec.loader.exec_module(_bte)
sys.modules['bte'] = _bte

sys.argv = ['propose_sublineages.py'] + list(ARGV)
runpy.run_path('/autolin/propose_sublineages.py', run_name='__main__')
`);

  const pb = FS.readFile('/autolin/out.pb');           // Uint8Array
  const dump = new TextDecoder().decode(FS.readFile('/autolin/dump.tsv'));
  const labels = new TextDecoder().decode(FS.readFile('/autolin/labels.tsv'));
  const nLineages = dump.trim() ? dump.trim().split('\n').length - 1 : 0;
  post({ type: 'stage', stage: 'done' });
  // transfer the pb buffer to avoid a copy
  const pbBuf = pb.buffer.slice(pb.byteOffset, pb.byteOffset + pb.byteLength);
  self.postMessage({ type: 'result', pb: pbBuf, dump, labels, nLineages }, [pbBuf]);
}

function post(msg) { self.postMessage(msg); }

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') { await initPyodide(); post({ type: 'ready' }); }
    else if (msg.type === 'run') { await run(msg.pb, msg.params); }
  } catch (err) {
    post({ type: 'error', message: String(err && err.stack || err) });
  }
};
