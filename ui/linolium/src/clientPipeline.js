// Client-side AutoLin pipeline — the backendless replacement for the
// POST /upload + POST /run-autolin + matUtils/convert chain. Orchestrates the
// two web workers (autolinWorker = Pyodide+shim, convertWorker = JS ports) and
// returns an in-memory Taxonium `sourceData` object the viewer consumes with NO
// backendUrl. Drop-in for LauncherApp.runPipeline.
//
//   const { sourceData, annotatedPb, dumpTsv, labelsTsv, nLineages } =
//       await runClientPipeline(fileOrArrayBuffer, params, { onLog, onStage });
//
// `sourceData` = { status:'loaded', filename:'autolin.jsonl', filetype:'jsonl',
//                  data:<ArrayBuffer of jsonl> }  → pass as <Taxonium sourceData={...}/>

// Vite worker imports (bundled, no separate files to host):
import AutolinWorker from '../worker/autolinWorker.js?worker';
import ConvertWorker from '../worker/convertWorker.js?worker';

// Decompress a gzipped buffer in the browser. Keyed on the gzip magic bytes
// (0x1f 0x8b) rather than the filename, so a .pb.gz upload — or any gzipped
// .pb — is transparently inflated before it reaches the Pyodide shim, which
// only understands raw MAT protobuf. Falls back to the raw bytes if
// DecompressionStream is unavailable (very old browsers).
async function maybeGunzip(buf) {
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  const isGzip = head.length === 2 && head[0] === 0x1f && head[1] === 0x8b;
  if (!isGzip) return buf;
  if (typeof DecompressionStream === 'undefined') return buf;
  const ds = new DecompressionStream('gzip');
  const stream = new Response(buf).body.pipeThrough(ds);
  return await new Response(stream).arrayBuffer();
}

async function readAsArrayBuffer(fileOrBuf) {
  const buf = (fileOrBuf instanceof ArrayBuffer)
    ? fileOrBuf
    : await fileOrBuf.arrayBuffer();            // File / Blob
  return maybeGunzip(buf);                       // inflate .pb.gz transparently
}

// One-shot request/response over a worker with a streamed-log side channel.
function callWorker(worker, message, transfer, { onLog, onStage } = {}) {
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'log') { onLog && onLog(m.message); return; }
      if (m.type === 'stage') { onStage && onStage(m.stage); return; }
      if (m.type === 'result') { resolve(m); return; }
      if (m.type === 'ready') { resolve(m); return; }
      if (m.type === 'error') { reject(new Error(m.message)); return; }
    };
    worker.onerror = (err) => reject(err);
    worker.postMessage(message, transfer || []);
  });
}

export async function runClientPipeline(fileOrBuf, params = {}, hooks = {}) {
  const { onLog = () => {}, onStage = () => {} } = hooks;
  const pbBuffer = await readAsArrayBuffer(fileOrBuf);

  // Stage 1+2: AutoLin in Pyodide (propose_sublineages.py on the pure-Python shim)
  onStage('proposing');
  onLog('Starting AutoLin (Pyodide)…');
  const autolin = new AutolinWorker();
  let result;
  try {
    // transfer a COPY so the caller keeps the original .pb if needed
    const pbCopy = pbBuffer.slice(0);
    result = await callWorker(
      autolin,
      { type: 'run', pb: pbCopy, params },
      [pbCopy],
      { onLog, onStage }
    );
  } finally {
    autolin.terminate();
  }
  onLog(`AutoLin done: ${result.nLineages} lineages proposed`);

  // Stage 3: convert annotated .pb → Taxonium jsonl (JS ports)
  onStage('converting');
  onLog('Converting to Taxonium format…');
  const convert = new ConvertWorker();
  let conv;
  try {
    const annotatedPb = result.pb;               // ArrayBuffer (transferred back)
    const pbForConvert = annotatedPb.slice(0);
    conv = await callWorker(
      convert,
      { type: 'convert', pb: pbForConvert },
      [pbForConvert]
    );
  } finally {
    convert.terminate();
  }
  onLog(`Conversion done: ${conv.nNodes} nodes`);

  // Build the in-memory SourceData the local backend expects
  const jsonlBuffer = new TextEncoder().encode(conv.jsonl).buffer;
  // original autolin .pb bytes as an ArrayBuffer, for the client-side pb export
  const pbBytes = result.pb instanceof Uint8Array
    ? result.pb.buffer.slice(result.pb.byteOffset, result.pb.byteOffset + result.pb.byteLength)
    : result.pb;
  const sourceData = {
    status: 'loaded',
    filename: 'autolin.jsonl',      // must contain 'jsonl' (worker gate); no 'gz' => plain text
    filetype: 'jsonl',
    data: jsonlBuffer,
    pipelinePb: pbBytes,            // consumed by <Taxonium> → localBackend.setPipelinePb
  };
  onStage('done');

  return {
    sourceData,
    annotatedPb: result.pb,          // for the "download .pb" button
    dumpTsv: result.dump,
    labelsTsv: result.labels,
    summaryTsv: conv.summaryTsv,     // for the "download TSV" button
    jsonl: conv.jsonl,               // for the "download jsonl" button
    nLineages: result.nLineages,
  };
}
