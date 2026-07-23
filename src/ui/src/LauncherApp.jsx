import React, { useState, useCallback, useRef, useEffect } from 'react';
import { runClientPipeline } from './clientPipeline';
import { BACKEND_URL, BACKENDLESS } from './config';

/**
 * LauncherApp - A modern, sleek launcher UI for the lineage curation pipeline
 * 
 * Allows users to:
 * - Drag/drop or upload .pb files
 * - Configure propose_sublineages.py parameters
 * - Run the autolin pipeline
 * - View progress and logs
 * - Launch Taxonium when complete
 */

// Pipeline stages for progress tracking
const STAGES = {
  IDLE: 'idle',
  UPLOADING: 'uploading',
  PROPOSING: 'proposing',
  CONVERTING: 'converting',
  LOADING: 'loading',
  COMPLETE: 'complete',
  ERROR: 'error'
};

// Browser-side AutoLin holds the tree in memory; refuse trees that would wedge the
// tab and point at the Docker app instead.
const MAX_REMOTE_BYTES = 100 * 1024 * 1024;

const pbNameFromUrl = (u) => {
  try {
    return (new URL(u).pathname.split('/').pop() || 'tree.pb').replace(/\.gz$/i, '');
  } catch {
    return 'tree.pb';
  }
};

// Fetch a (possibly gzipped) protobuf and hand back a File the pipeline accepts.
// Hosts commonly serve .gz with `Content-Encoding: gzip`, so the browser has already
// inflated it — key off the gzip magic bytes to avoid double-inflating. Over the size
// limit it throws a TOO_LARGE error (unless `force`) so the caller can offer an
// override.
async function fetchPbAsFile(url, filename, { force = false } = {}) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);

  const declared = Number(resp.headers.get('content-length') || 0);
  if (!force && declared > MAX_REMOTE_BYTES) {
    const err = new Error(`Tree is ${(declared / 1024 / 1024).toFixed(0)} MB`);
    err.code = 'TOO_LARGE';
    err.sizeMB = Math.round(declared / 1024 / 1024);
    throw err;
  }

  let bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.length > 1 && bytes[0] === 0x1f && bytes[1] === 0x8b &&
      typeof DecompressionStream !== 'undefined') {
    const inflated = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(inflated).arrayBuffer());
  }
  return new File([bytes], filename, { type: 'application/octet-stream' });
}

const STAGE_LABELS = {
  [STAGES.IDLE]: 'Ready',
  [STAGES.UPLOADING]: 'Uploading file...',
  [STAGES.PROPOSING]: 'Running propose_sublineages.py...',
  [STAGES.CONVERTING]: 'Converting to Taxonium format...',
  [STAGES.LOADING]: 'Loading viewer...',
  [STAGES.COMPLETE]: 'Complete!',
  [STAGES.ERROR]: 'Error'
};

function LauncherApp({ onLaunchTaxonium, onDownloadsReady }) {
  // File state
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Pipeline parameters (from propose_sublineages.py argparser)
  const [params, setParams] = useState({
    minsamples: 10,
    distinction: 1,
    recursive: true,
    cutoff: 0.95,
    floor: 0,
    verbose: true,
    clear: false
  });

  // Advanced options toggle
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Pipeline state
  const [stage, setStage] = useState(STAGES.IDLE);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [largeTree, setLargeTree] = useState(null); // { url, filename, sizeMB } — pending oversized fetch
  const [outputFile, setOutputFile] = useState(null);
  const [sourceData, setSourceData] = useState(null); // in-memory Taxonium jsonl (backendless)
  const [downloads, setDownloads] = useState([]);
  const [showMoreDownloads, setShowMoreDownloads] = useState(false);

  // Logs container ref for auto-scroll
  const logsRef = useRef(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  // Add log message
  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, message, type }]);
  }, []);

  // Handle file drop
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith('.pb') || droppedFile.name.endsWith('.pb.gz'))) {
      setFile(droppedFile);
      addLog(`Selected file: ${droppedFile.name} (${(droppedFile.size / 1024 / 1024).toFixed(2)} MB)`);
    } else {
      addLog('Please select a .pb or .pb.gz file', 'error');
    }
  }, [addLog]);

  // Handle file input change
  const handleFileChange = useCallback((e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && (selectedFile.name.endsWith('.pb') || selectedFile.name.endsWith('.pb.gz'))) {
      setFile(selectedFile);
      addLog(`Selected file: ${selectedFile.name} (${(selectedFile.size / 1024 / 1024).toFixed(2)} MB)`);
    } else if (selectedFile) {
      addLog('Please select a .pb or .pb.gz file', 'error');
    }
  }, [addLog]);

  // Handle drag events
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  // Update parameter
  const updateParam = useCallback((key, value) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  // Run the pipeline. Accepts an optional File/Blob (used by the sample-data
  // button); when called as a click handler the event arg is ignored and the
  // selected `file` state is used instead.
  const runPipelineServer = useCallback(async (fileArg) => {
    const theFile = (fileArg instanceof File || fileArg instanceof Blob) ? fileArg : file;
    if (!theFile) {
      addLog('No file selected', 'error');
      return;
    }

    setError(null);
    setLogs([]);
    setProgress(0);

    try {
      // Stage 1: Upload file
      setStage(STAGES.UPLOADING);
      addLog('Uploading file to server...');
      setProgress(10);

      const formData = new FormData();
      formData.append('file', theFile);

      const uploadResponse = await fetch(`${BACKEND_URL}/upload`, {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`);
      }

      const uploadResult = await uploadResponse.json();
      addLog(`File uploaded: ${uploadResult.filename}`, 'success');
      setProgress(25);

      // Stage 2: Run propose_sublineages
      setStage(STAGES.PROPOSING);
      addLog('Running propose_sublineages.py...');
      addLog(`Parameters: minsamples=${params.minsamples}, distinction=${params.distinction}, recursive=${params.recursive}`);

      const proposeResponse = await fetch(`${BACKEND_URL}/run-autolin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputFile: uploadResult.path,
          params: {
            minsamples: params.minsamples,
            distinction: params.distinction,
            recursive: params.recursive,
            cutoff: params.cutoff,
            floor: params.floor,
            verbose: params.verbose,
            clear: params.clear
          }
        })
      });

      if (!proposeResponse.ok) {
        const errorData = await proposeResponse.json();
        throw new Error(errorData.error || 'Pipeline failed');
      }

      // Stream logs from the response
      const reader = proposeResponse.body.getReader();
      const decoder = new TextDecoder();
      let pipelineResult = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            
            if (data.type === 'log') {
              addLog(data.message);
            } else if (data.type === 'stage') {
              if (data.stage === 'proposing') {
                setStage(STAGES.PROPOSING);
                setProgress(40);
              } else if (data.stage === 'converting') {
                setStage(STAGES.CONVERTING);
                setProgress(60);
              } else if (data.stage === 'summary') {
                setProgress(80);
              }
            } else if (data.type === 'complete') {
              pipelineResult = data;
            } else if (data.type === 'error') {
              throw new Error(data.message);
            }
          } catch (parseError) {
            // Not JSON, treat as plain log
            if (line.trim()) {
              addLog(line);
            }
          }
        }
      }

      if (!pipelineResult) {
        throw new Error('Pipeline did not return a result');
      }

      setProgress(90);
      addLog(`Pipeline complete! Output: ${pipelineResult.outputFile}`, 'success');
      setOutputFile(pipelineResult.outputFile);
      if (pipelineResult.downloads) {
        setDownloads(pipelineResult.downloads);
        if (onDownloadsReady) onDownloadsReady(pipelineResult.downloads);
      }

      // Stage 3: Load viewer
      setStage(STAGES.LOADING);
      addLog('Starting Taxonium viewer...');
      setProgress(95);

      // Small delay to ensure backend is ready
      await new Promise(resolve => setTimeout(resolve, 1000));

      setStage(STAGES.COMPLETE);
      setProgress(100);
      addLog('Ready to view!', 'success');

    } catch (err) {
      console.error('Pipeline error:', err);
      setStage(STAGES.ERROR);
      setError(err.message);
      addLog(`Error: ${err.message}`, 'error');
    }
  }, [file, params, addLog]);

  const runPipelineClient = useCallback(async (fileArg) => {
    const theFile = (fileArg instanceof File || fileArg instanceof Blob) ? fileArg : file;
    if (!theFile) {
      addLog('No file selected', 'error');
      return;
    }

    setError(null);
    setLogs([]);
    setProgress(0);

    try {
      // Everything runs in the browser — no server upload, no /run-autolin.
      // AutoLin (Pyodide + pure-Python bte shim) then the JS matUtils/usher_to_taxonium
      // ports, orchestrated by runClientPipeline over two web workers.
      addLog(`File: ${theFile.name} (${(theFile.size / 1024 / 1024).toFixed(2)} MB)`, 'success');
      addLog(`Parameters: minsamples=${params.minsamples}, distinction=${params.distinction}, recursive=${params.recursive}`);
      setProgress(10);

      const result = await runClientPipeline(theFile, params, {
        onLog: (message) => addLog(message),
        onStage: (s) => {
          if (s === 'loading') { setStage(STAGES.PROPOSING); setProgress(20); addLog('Loading Pyodide runtime…'); }
          else if (s === 'proposing') { setStage(STAGES.PROPOSING); setProgress(40); }
          else if (s === 'converting') { setStage(STAGES.CONVERTING); setProgress(70); }
          else if (s === 'done') { setProgress(90); }
        },
      });

      addLog(`Pipeline complete: ${result.nLineages} lineages proposed`, 'success');
      setSourceData(result.sourceData);
      setOutputFile('client');   // sentinel: data is in memory, not a server path

      // Offer in-memory downloads (annotated .pb, TSVs, jsonl) without a backend
      const dl = [
        { label: 'Annotated protobuf (.pb)', filename: 'autolin.pb',
          blob: new Blob([result.annotatedPb], { type: 'application/octet-stream' }) },
        { label: 'Proposed sublineages (dump.tsv)', filename: 'autolin.dump.tsv',
          blob: new Blob([result.dumpTsv], { type: 'text/tab-separated-values' }) },
        { label: 'Sample labels (labels.tsv)', filename: 'autolin.labels.tsv',
          blob: new Blob([result.labelsTsv], { type: 'text/tab-separated-values' }) },
        { label: 'Sample clade summary (.tsv)', filename: 'autolin.summary.tsv',
          blob: new Blob([result.summaryTsv], { type: 'text/tab-separated-values' }) },
        { label: 'Taxonium (.jsonl)', filename: 'autolin.jsonl',
          blob: new Blob([result.jsonl], { type: 'application/json' }) },
      ];
      setDownloads(dl);
      if (onDownloadsReady) onDownloadsReady(dl);

      setStage(STAGES.COMPLETE);
      setProgress(100);
      addLog('Ready to view!', 'success');

    } catch (err) {
      console.error('Pipeline error:', err);
      setStage(STAGES.ERROR);
      setError(err.message);
      addLog(`Error: ${err.message}`, 'error');
    }
  }, [file, params, addLog, onDownloadsReady]);

  // Dispatch: backendless (Pyodide, in-browser) vs server (Docker/local backend).
  const runPipeline = useCallback((fileArg) => (
    BACKENDLESS ? runPipelineClient(fileArg) : runPipelineServer(fileArg)
  ), [runPipelineClient, runPipelineServer]);

  // Launch Taxonium viewer — hand the in-memory jsonl (sourceData) to the viewer;
  // no backend path is passed, so Taxonium runs on its local worker.
  const handleLaunch = useCallback(() => {
    if (onLaunchTaxonium) {
      onLaunchTaxonium(BACKENDLESS ? sourceData : outputFile);
    }
  }, [onLaunchTaxonium, sourceData, outputFile]);

  // Use sample data — fetch the raw MTB lineage-4.8 protobuf (shipped gzipped as
  // public/mtb.4.8.pb.gz), decompress it in the browser, and run the FULL AutoLin
  // pipeline on it — exactly as if the user had uploaded mtb.4.8.pb. This exercises
  // Pyodide + the bte shim + the JS converter end-to-end (reports 482 lineages
  // proposed, matching golden mtb.4.8), rather than just loading a pre-computed
  // tree into the viewer.
  const useSampleData = useCallback(async () => {
    setError(null);
    setLogs([]);
    addLog('Fetching sample tree (MTB lineage 4.8)…');

    try {
      setStage(STAGES.LOADING);
      setProgress(5);
      const base = import.meta.env.BASE_URL || '/';
      const url = new URL(`${base}mtb.4.8.pb.gz`, window.location.origin).href;
      const sampleFile = await fetchPbAsFile(url, 'mtb.4.8.pb');
      setFile(sampleFile);
      addLog(`Sample loaded: mtb.4.8.pb (${(sampleFile.size / 1024 / 1024).toFixed(2)} MB) — running AutoLin…`, 'success');

      // Run the SAME pipeline the upload path uses — AutoLin in the browser
      // (backendless) or on the backend (server). Identical behavior either way.
      await runPipeline(sampleFile);
    } catch (err) {
      setStage(STAGES.ERROR);
      setError(err.message);
      addLog(`Error: ${err.message}`, 'error');
    }
  }, [addLog, runPipeline]);

  // Deep link: ?pb=<url> loads a remote protobuf so other sites (e.g. a Taxonium
  // tree page) can hand a tree to Linolium. The user reviews parameters and clicks
  // Run Pipeline — we don't auto-run.
  const deepLinkStarted = useRef(false);
  useEffect(() => {
    if (deepLinkStarted.current) return;
    const pbUrl = new URLSearchParams(window.location.search).get('pb');
    if (!pbUrl) return;
    if (!/^https?:\/\//i.test(pbUrl)) {
      addLog('Ignoring ?pb= — only http(s) URLs are supported', 'error');
      return;
    }
    deepLinkStarted.current = true;

    (async () => {
      addLog(`Fetching tree from ${pbUrl}`);
      try {
        const remote = await fetchPbAsFile(pbUrl, pbNameFromUrl(pbUrl));
        setFile(remote);
        addLog(`Loaded ${remote.name} (${(remote.size / 1024 / 1024).toFixed(2)} MB) — click Run Pipeline to start.`, 'success');
      } catch (err) {
        if (err.code === 'TOO_LARGE') {
          setLargeTree({ url: pbUrl, filename: pbNameFromUrl(pbUrl), sizeMB: err.sizeMB });
          addLog(`Tree is ${err.sizeMB} MB — large trees may be slow or crash the tab.`, 'error');
        } else {
          setError(err.message);
          addLog(`Error: ${err.message}`, 'error');
        }
      }
    })();
  }, [addLog]);

  // Override the size guard and load the oversized tree anyway (backendless only —
  // the Docker path has no such limit).
  const proceedLargeTree = useCallback(async () => {
    if (!largeTree) return;
    const { url, filename } = largeTree;
    setLargeTree(null);
    addLog(`Loading ${filename} anyway…`);
    try {
      const remote = await fetchPbAsFile(url, filename, { force: true });
      setFile(remote);
      addLog(`Loaded ${remote.name} (${(remote.size / 1024 / 1024).toFixed(2)} MB) — click Run Pipeline to start.`, 'success');
    } catch (err) {
      setError(err.message);
      addLog(`Error: ${err.message}`, 'error');
    }
  }, [largeTree, addLog]);

  const isRunning = stage !== STAGES.IDLE && stage !== STAGES.COMPLETE && stage !== STAGES.ERROR;
  const canRun = file && !isRunning;
  const canLaunch = stage === STAGES.COMPLETE;

  return (
    <div className="launcher-container">
      <style>{`
        .launcher-container {
          min-height: 100vh;
          background: #f8fafc;
          color: #334155;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
          padding: 2rem;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .launcher-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 2rem;
          max-width: 640px;
          width: 100%;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .launcher-header {
          margin-bottom: 1.5rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid #e2e8f0;
        }

        .launcher-title {
          font-size: 1.5rem;
          font-weight: 600;
          color: #1e293b;
          margin: 0 0 0.25rem 0;
        }

        .launcher-subtitle {
          color: #64748b;
          font-size: 0.875rem;
          margin: 0;
        }

        .drop-zone {
          border: 1px dashed #cbd5e1;
          border-radius: 6px;
          padding: 2rem;
          text-align: center;
          cursor: pointer;
          transition: all 0.15s ease;
          background: #fafafa;
          margin-bottom: 1.5rem;
        }

        .drop-zone:hover, .drop-zone.dragging {
          border-color: #3b82f6;
          background: #f0f9ff;
        }

        .drop-zone.has-file {
          border-color: #22c55e;
          border-style: solid;
          background: #f0fdf4;
        }

        .drop-icon {
          font-size: 2rem;
          margin-bottom: 0.5rem;
          opacity: 0.7;
        }

        .drop-text {
          font-size: 0.95rem;
          color: #475569;
          margin-bottom: 0.25rem;
        }

        .drop-hint {
          color: #94a3b8;
          font-size: 0.8rem;
        }

        .file-info {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          justify-content: center;
        }

        .file-name {
          font-weight: 500;
          color: #16a34a;
        }

        .file-size {
          color: #64748b;
          font-size: 0.8rem;
        }

        .section-title {
          font-size: 0.75rem;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.75rem;
        }

        .params-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .param-group {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }

        .param-label {
          font-size: 0.8rem;
          color: #475569;
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }

        .param-input {
          background: #ffffff;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          padding: 0.5rem 0.75rem;
          color: #1e293b;
          font-size: 0.875rem;
          transition: border-color 0.15s;
        }

        .param-input:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
        }

        .param-input:disabled {
          background: #f1f5f9;
          color: #94a3b8;
          cursor: not-allowed;
        }

        .checkbox-group {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 0;
        }

        .checkbox-input {
          width: 1rem;
          height: 1rem;
          accent-color: #3b82f6;
          cursor: pointer;
        }

        .advanced-toggle {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          color: #64748b;
          font-size: 0.8rem;
          cursor: pointer;
          margin-bottom: 1rem;
          transition: color 0.15s;
        }

        .advanced-toggle:hover {
          color: #3b82f6;
        }

        .advanced-section {
          padding: 1rem;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          margin-bottom: 1rem;
        }

        .button-row {
          display: flex;
          gap: 0.75rem;
          margin-bottom: 1rem;
        }

        .btn {
          flex: 1;
          padding: 0.625rem 1rem;
          border-radius: 6px;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }

        .btn-primary {
          background: #3b82f6;
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background: #2563eb;
        }

        .btn-primary:disabled {
          background: #94a3b8;
          cursor: not-allowed;
        }

        .btn-secondary {
          background: #ffffff;
          color: #475569;
          border: 1px solid #d1d5db;
        }

        .btn-secondary:hover:not(:disabled) {
          background: #f8fafc;
          border-color: #9ca3af;
        }

        .btn-success {
          background: #22c55e;
          color: white;
        }

        .btn-success:hover {
          background: #16a34a;
        }

        .progress-section {
          margin-bottom: 1rem;
          padding: 1rem;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
        }

        .progress-bar-container {
          background: #e2e8f0;
          border-radius: 4px;
          height: 6px;
          overflow: hidden;
          margin-bottom: 0.5rem;
        }

        .progress-bar {
          height: 100%;
          background: #3b82f6;
          border-radius: 4px;
          transition: width 0.3s ease;
        }

        .progress-status {
          display: flex;
          justify-content: space-between;
          font-size: 0.8rem;
        }

        .progress-stage {
          color: #64748b;
        }

        .progress-percent {
          color: #3b82f6;
          font-weight: 500;
        }

        .downloads-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }

        .download-btn {
          flex: none;
          font-size: 0.8rem;
          text-decoration: none;
          padding: 0.5rem 0.75rem;
        }

        .logs-container {
          background: #1e293b;
          border-radius: 6px;
          padding: 0.75rem 1rem;
          max-height: 180px;
          overflow-y: auto;
          font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
          font-size: 0.75rem;
        }

        .log-entry {
          display: flex;
          gap: 0.5rem;
          padding: 0.125rem 0;
        }

        .log-time {
          color: #64748b;
          flex-shrink: 0;
        }

        .log-message {
          color: #cbd5e1;
        }

        .log-message.success {
          color: #4ade80;
        }

        .log-message.error {
          color: #f87171;
        }

        .error-banner {
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 6px;
          padding: 0.75rem 1rem;
          color: #dc2626;
          font-size: 0.875rem;
          margin-bottom: 1rem;
        }

        .warn-banner {
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 6px;
          padding: 0.75rem 1rem;
          color: #92400e;
          font-size: 0.875rem;
          margin-bottom: 1rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }
        .warn-banner a { color: #92400e; text-decoration: underline; }
        .warn-banner .btn-sm {
          padding: 0.4rem 0.75rem;
          font-size: 0.8125rem;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .or-divider {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin: 1rem 0;
          color: #94a3b8;
          font-size: 0.8rem;
        }

        .or-divider::before,
        .or-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #e2e8f0;
        }

        .sample-btn {
          width: 100%;
          padding: 0.625rem;
          background: transparent;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          color: #64748b;
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.15s;
        }

        .sample-btn:hover {
          background: #f8fafc;
          border-color: #cbd5e1;
          color: #475569;
        }

        .spinner {
          width: 1rem;
          height: 1rem;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .tooltip {
          position: relative;
          cursor: help;
          color: #94a3b8;
        }

        .tooltip::after {
          content: attr(data-tooltip);
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          background: #1e293b;
          color: #e2e8f0;
          padding: 0.375rem 0.625rem;
          border-radius: 4px;
          font-size: 0.7rem;
          white-space: nowrap;
          opacity: 0;
          visibility: hidden;
          transition: all 0.15s;
          z-index: 100;
          margin-bottom: 4px;
        }

        .tooltip:hover::after {
          opacity: 1;
          visibility: visible;
        }
      `}</style>

      <div className="launcher-card">
        <header className="launcher-header">
          <h1 className="launcher-title">Linolium</h1>
          <p className="launcher-subtitle">
            Upload a protobuf tree, configure parameters, and launch the viewer
          </p>
        </header>

        {/* File Drop Zone. The <input> is a SIBLING of the clickable div, not a
            child: when it was nested, the programmatic fileInputRef.click() bubbled
            back into the div's onClick, and Chrome treated that nested click as
            consuming the transient user activation — silently refusing to open the
            native file picker. Keeping the input outside removes the re-entrancy. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pb,.pb.gz,.gz,application/gzip"
          onChange={handleFileChange}
          style={{ display: 'none' }}
          disabled={isRunning}
        />
        <div
          className={`drop-zone ${isDragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          {file ? (
            <div className="file-info">
              <div>
                <div className="file-name">{file.name}</div>
                <div className="file-size">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
              </div>
            </div>
          ) : (
            <>
              <div className="drop-icon">↑</div>
              <div className="drop-text">Drop .pb (.gz) file here or click to browse</div>
              <div className="drop-hint">Protobuf phylogenetic tree file</div>
            </>
          )}
        </div>

        {/* Parameters Section */}
        <div className="section-title">Parameters</div>
        <div className="params-grid">
          <div className="param-group">
            <label className="param-label">
              Min Samples
              <span className="tooltip" data-tooltip="Minimum samples per lineage">ⓘ</span>
            </label>
            <input
              type="number"
              className="param-input"
              value={params.minsamples}
              onChange={(e) => updateParam('minsamples', parseInt(e.target.value) || 0)}
              disabled={isRunning}
              min={1}
            />
          </div>
          <div className="param-group">
            <label className="param-label">
              Distinction
              <span className="tooltip" data-tooltip="Min mutations from parent">ⓘ</span>
            </label>
            <input
              type="number"
              className="param-input"
              value={params.distinction}
              onChange={(e) => updateParam('distinction', parseInt(e.target.value) || 0)}
              disabled={isRunning}
              min={0}
            />
          </div>
          <div className="param-group checkbox-group">
            <input
              type="checkbox"
              className="checkbox-input"
              checked={params.recursive}
              onChange={(e) => updateParam('recursive', e.target.checked)}
              disabled={isRunning}
              id="recursive"
            />
            <label htmlFor="recursive" className="param-label" style={{ margin: 0 }}>
              Recursive
              <span className="tooltip" data-tooltip="Add sublineages to new lineages">ⓘ</span>
            </label>
          </div>
          <div className="param-group checkbox-group">
            <input
              type="checkbox"
              className="checkbox-input"
              checked={params.verbose}
              onChange={(e) => updateParam('verbose', e.target.checked)}
              disabled={isRunning}
              id="verbose"
            />
            <label htmlFor="verbose" className="param-label" style={{ margin: 0 }}>
              Verbose Output
            </label>
          </div>
        </div>

        {/* Advanced Options */}
        <div 
          className="advanced-toggle"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <span>{showAdvanced ? '▼' : '▶'}</span>
          <span>Advanced Options</span>
        </div>

        {showAdvanced && (
          <div className="advanced-section">
            <div className="params-grid">
              <div className="param-group">
                <label className="param-label">
                  Cutoff
                  <span className="tooltip" data-tooltip="Stop when this proportion covered">ⓘ</span>
                </label>
                <input
                  type="number"
                  className="param-input"
                  value={params.cutoff}
                  onChange={(e) => updateParam('cutoff', parseFloat(e.target.value) || 0)}
                  disabled={isRunning}
                  min={0}
                  max={1}
                  step={0.05}
                />
              </div>
              <div className="param-group">
                <label className="param-label">
                  Floor
                  <span className="tooltip" data-tooltip="Minimum score to report">ⓘ</span>
                </label>
                <input
                  type="number"
                  className="param-input"
                  value={params.floor}
                  onChange={(e) => updateParam('floor', parseFloat(e.target.value) || 0)}
                  disabled={isRunning}
                  min={0}
                  step={0.1}
                />
              </div>
              <div className="param-group checkbox-group">
                <input
                  type="checkbox"
                  className="checkbox-input"
                  checked={params.clear}
                  onChange={(e) => updateParam('clear', e.target.checked)}
                  disabled={isRunning}
                  id="clear"
                />
                <label htmlFor="clear" className="param-label" style={{ margin: 0 }}>
                  Clear existing annotations
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Large-tree warning with an override */}
        {largeTree && (
          <div className="warn-banner">
            <div>
              <strong>{largeTree.filename}</strong> is {largeTree.sizeMB} MB. Running
              AutoLin in the browser may be slow or crash the tab — the{' '}
              <a href="https://github.com/corbett-lab/linolium#quick-start-local"
                 target="_blank" rel="noopener noreferrer">Docker app</a>{' '}
              handles large trees better.
            </div>
            <button className="btn btn-secondary btn-sm" onClick={proceedLargeTree}>
              Proceed anyway
            </button>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="error-banner">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Progress Section */}
        {stage !== STAGES.IDLE && (
          <div className="progress-section">
            <div className="progress-bar-container">
              <div className="progress-bar" style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-status">
              <span className="progress-stage">{STAGE_LABELS[stage]}</span>
              <span className="progress-percent">{progress}%</span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="button-row">
          {canLaunch ? (
            <button className="btn btn-success" onClick={handleLaunch}>
              Launch Viewer
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={runPipeline}
              disabled={!canRun}
            >
              {isRunning ? (
                <>
                  <div className="spinner" />
                  Processing...
                </>
              ) : (
                <>Run Pipeline</>
              )}
            </button>
          )}
          {file && !isRunning && stage !== STAGES.COMPLETE && (
            <button
              className="btn btn-secondary"
              onClick={() => {
                setFile(null);
                setStage(STAGES.IDLE);
                setLogs([]);
                setError(null);
                setDownloads([]);
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Download Results — the summary TSV (+ pb, jsonl) shows by default;
            AutoLin's two extra tables (per-lineage dump, per-sample labels) sit
            behind "More outputs". Identical in both modes. */}
        {downloads.length > 0 && stage === STAGES.COMPLETE && (() => {
          const nameOf = (dl) => (BACKENDLESS ? dl.filename : dl.name);
          const extraText = (dl) => {
            const f = nameOf(dl);
            if (f.includes('.dump.')) return 'per-lineage info (.tsv)';
            if (f.includes('.labels.')) return 'sample labels (.tsv)';
            return null;   // not an extra table
          };
          const mainText = (dl) => {
            const f = nameOf(dl);
            if (f.includes('.pb')) return f.endsWith('.gz') ? '.pb.gz' : '.pb';
            if (f.includes('jsonl')) return f.endsWith('.gz') ? '.jsonl.gz' : '.jsonl';
            return '.tsv';   // the clade summary
          };
          const renderDl = (dl, i, text) => (
            BACKENDLESS ? (
              <button
                key={i}
                className="btn btn-secondary download-btn"
                title={dl.label || nameOf(dl)}
                onClick={() => {
                  // Client-side download from the in-memory Blob — no backend.
                  const url = URL.createObjectURL(dl.blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = dl.filename;
                  document.body.appendChild(a); a.click();
                  document.body.removeChild(a); URL.revokeObjectURL(url);
                }}
              >
                {text}
              </button>
            ) : (
              <a
                key={i}
                className="btn btn-secondary download-btn"
                title={dl.label || nameOf(dl)}
                href={`${BACKEND_URL}/download?path=${encodeURIComponent(dl.path)}`}
                download={dl.name}
              >
                {text}
              </a>
            )
          );
          const mainDl = downloads.filter((dl) => !extraText(dl));
          const extraDl = downloads.filter((dl) => extraText(dl));
          return (
            <>
              <div className="section-title">Download Autolin results</div>
              <div className="downloads-row">
                {mainDl.map((dl, i) => renderDl(dl, i, mainText(dl)))}
              </div>
              {extraDl.length > 0 && (
                <>
                  <div className="advanced-toggle" onClick={() => setShowMoreDownloads((v) => !v)}>
                    <span>{showMoreDownloads ? '▼' : '▶'}</span> More outputs
                  </div>
                  {showMoreDownloads && (
                    <div className="downloads-row">
                      {extraDl.map((dl, i) => renderDl(dl, i, extraText(dl)))}
                    </div>
                  )}
                </>
              )}
            </>
          );
        })()}

        {/* Logs */}
        {logs.length > 0 && (
          <>
            <div className="section-title">Logs</div>
            <div className="logs-container" ref={logsRef}>
              {logs.map((log, i) => (
                <div key={i} className="log-entry">
                  <span className="log-time">{log.timestamp}</span>
                  <span className={`log-message ${log.type}`}>{log.message}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Or use sample data */}
        {stage === STAGES.IDLE && !file && (
          <>
            <div className="or-divider">or</div>
            <button className="sample-btn" onClick={useSampleData}>
              Use sample data to explore the interface
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default LauncherApp;
