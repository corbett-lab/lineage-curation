import { useCallback, useMemo, useEffect, useState } from "react";
import type {
  Config,
  NodesResponse,
  NodeDetails,
  SearchResult,
  QueryBounds,
  LocalBackend,
} from "../types/backend";
import type {
  StatusData,
  QueryData,
  SearchData,
  ConfigData,
  DetailsData,
  ListData,
  NextStrainData,
  LocalBackendMessage,
} from "../types/localBackendWorker";
import type { Node, Mutation } from "../types/node";

// test
//const workerPath = "../webworkers/localBackendWorker.js";

import workerSpec from "../webworkers/localBackendWorker.js?worker&inline";

//const url = new URL('../webworkers/localBackendWorker.js', import.meta.url)
//const getWorker = () => new Worker(url, { type: 'module' })

const worker = new workerSpec();

let onQueryReceipt: (receivedData: NodesResponse) => void = () => {};
let onStatusReceipt: (receivedData: StatusData) => void = (receivedData) => {
  /* STATUS update */
};

let onConfigReceipt: (receivedData: Config) => void = () => {};
let onDetailsReceipt: (receivedData: NodeDetails) => void = () => {};
let onListReceipt: (receivedData: ListData["data"]) => void = () => {};
let onNextStrainReceipt: (receivedData: NextStrainData["data"]) => void = (
  receivedData
) => {
  // create a blob with this data and trigger download
  const blob = new Blob([JSON.stringify(receivedData)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = "nextstrain.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};

let searchSetters: Record<string, (data: SearchResult) => void> = {};

worker.onmessage = (event: MessageEvent<LocalBackendMessage>) => {
  const data = event.data;
  switch (data.type) {
    case "status":
      onStatusReceipt(data);
      break;
    case "query":
      onQueryReceipt(data.data);
      break;
      case "search":
        if (data.data.key) {
          searchSetters[data.data.key]?.(data.data);
        }
        break;
    case "config":
      onConfigReceipt(data.data);
      break;
    case "details":
      onDetailsReceipt(data.data);
      break;
    case "list":
      onListReceipt(data.data);
      break;
    case "nextstrain":
      onNextStrainReceipt(data.data);
      break;
    case "lineages":
    case "merge-lineage":
    case "edit-lineage-root":
    case "undo-preview":
    case "undo-edit":
    case "edit-history":
    case "set-pipeline-pb":
    case "export": {
      const rid = (data as { requestId?: number }).requestId;
      if (rid !== undefined && editResolvers[rid]) {
        editResolvers[rid]((data as { data: unknown }).data);
        delete editResolvers[rid];
      }
      break;
    }
    default:
      break;
  }
};

// requestId-keyed promise resolvers for the editing round-trips
let editReqCounter = 0;
const editResolvers: Record<number, (data: unknown) => void> = {};
function editRequest(payload: Record<string, unknown>): Promise<unknown> {
  const requestId = ++editReqCounter;
  return new Promise((resolve) => {
    editResolvers[requestId] = resolve;
    worker.postMessage({ ...payload, requestId });
  });
}

function useLocalBackend(
  uploaded_data: Record<string, unknown> | null
): LocalBackend {
  const [statusMessage, setStatusMessage] = useState<
    | { percentage?: number; message?: string | null }
    | null
  >({ message: null });
  onStatusReceipt = (receivedData) => {
    if (receivedData.data.error) {
      console.error("Local backend error:", receivedData.data.error);
    }
    const total_nodes = receivedData.data.total as number | undefined;
    if (total_nodes && total_nodes > 6000000) {
      console.warn(
        "This is a large tree which may use too much memory to run in the web browser. If the page crashes you might want to try the Taxonium desktop app."
      );
    }
    setStatusMessage(receivedData.data);
  };
  useEffect(() => {
    if (!uploaded_data) return;
    // Exclude pipelinePb before posting: it's an ArrayBuffer that gets *transferred*
    // (and thus detached) separately via setPipelinePb, so structured-cloning it here
    // throws "An ArrayBuffer is detached and could not be cloned" — reliably so under
    // StrictMode's double effect-invoke. The upload handler never reads pipelinePb.
    const { pipelinePb: _pipelinePb, ...data } = uploaded_data;
    void _pipelinePb;
    worker.postMessage({
      type: "upload",
      data,
    });
  }, [uploaded_data]);

  const queryNodes = useCallback(
    async (
      boundsForQueries: QueryBounds | null,
      setResult: (res: NodesResponse) => void,
      setTriggerRefresh: (v: Record<string, unknown>) => void,
      config: Config
    ) => {
      
      worker.postMessage({
        type: "query",
        bounds: boundsForQueries,
      });
      onQueryReceipt = (receivedData) => {
        receivedData.nodes.forEach((node: Node) => {
          if (!config.mutations) return;
          if (node.node_id === config.rootId) {
            node.mutations = config.rootMutations
              .map((x) => (typeof x === "number" ? config.mutations?.[x] : x))
              .filter(Boolean) as Mutation[];
          } else {
            node.mutations = node.mutations
              .map((mutation: Mutation | number) =>
                typeof mutation === "number" ? config.mutations?.[mutation] : mutation
              )
              .filter(Boolean) as Mutation[];
          }
        });
        setResult(receivedData);
      };
    },
    []
  );

  const singleSearch = useCallback(
    (
      singleSearch: string,
      boundsForQueries: QueryBounds | null,
      setResult: (res: SearchResult) => void
    ) => {
      const key = JSON.parse(singleSearch).key;
      worker.postMessage({
        type: "search",
        search: singleSearch,
        bounds: boundsForQueries,
      });

      searchSetters[key] = (receivedData) => {
        setResult(receivedData);
      };
      return {
        abortController: {
          abort: () => {},
        },
      };
    },
    []
  );

  const getDetails = useCallback(
    (node_id: string | number, setResult: (res: NodeDetails) => void) => {
      worker.postMessage({
        type: "details",
        node_id: node_id,
      });
      onDetailsReceipt = (receivedData) => {
        setResult(receivedData);
      };
    },
    []
  );

  const getConfig = useCallback((setResult: (res: Config) => void) => {
    worker.postMessage({
      type: "config",
    });

    onConfigReceipt = (receivedData) => {
      setResult(receivedData);
    };
  }, []);

  const getTipAtts = useCallback(
    (
      nodeId: string | number,
      selectedKey: string,
      callback: (err: unknown, data: unknown) => void
    ) => {
    worker.postMessage({
      type: "list",
      node_id: nodeId,
      key: selectedKey,
    });

    onListReceipt = (receivedData) => {
      callback(null, receivedData);
    };
  }, []);

  const getNextstrainJson = useCallback((nodeId: string | number, config: Config) => {
    worker.postMessage({
      type: "nextstrain",
      node_id: nodeId,
      config: config,
    });
  }, []);

  // ---- lineage-editing methods (round-trip to the worker via editRequest) ----
  const getLineages = useCallback(
    (field = "meta_annotation_1") => editRequest({ type: "lineages", field }),
    []
  );
  const mergeLineage = useCallback(
    (lineageName: string, field = "meta_annotation_1") =>
      editRequest({ type: "merge-lineage", lineageName, field }),
    []
  );
  const editLineageRoot = useCallback(
    (lineageName: string, rootNodeId: string | number, field = "meta_annotation_1") =>
      editRequest({ type: "edit-lineage-root", lineageName, rootNodeId, field }),
    []
  );
  const undoPreview = useCallback(
    (editId: number) => editRequest({ type: "undo-preview", editId }),
    []
  );
  const undoEdit = useCallback(
    (editId?: number) => editRequest({ type: "undo-edit", editId }),
    []
  );
  const getEditHistory = useCallback(
    () => editRequest({ type: "edit-history" }),
    []
  );
  const buildExport = useCallback(
    (format: string, field = "meta_annotation_1", config: Record<string, unknown> = {}) =>
      editRequest({ type: "export", format, field, config }),
    []
  );
  const setPipelinePb = useCallback((pb: ArrayBuffer) => {
    // transfer the buffer to the worker zero-copy
    const requestId = ++editReqCounter;
    return new Promise((resolve) => {
      editResolvers[requestId] = resolve;
      worker.postMessage({ type: "set-pipeline-pb", pb, requestId }, [pb]);
    });
  }, []);

  return useMemo(() => {
    return {
      queryNodes,
      singleSearch,
      getDetails,
      getConfig,
      statusMessage,
      setStatusMessage,
      getTipAtts,
      getNextstrainJson,
      getLineages,
      mergeLineage,
      editLineageRoot,
      undoPreview,
      undoEdit,
      getEditHistory,
      buildExport,
      setPipelinePb,
      type: "local",
    };
  }, [
    queryNodes,
    singleSearch,
    getDetails,
    getConfig,
    statusMessage,
    setStatusMessage,
    getTipAtts,
    getNextstrainJson,
    getLineages,
    mergeLineage,
    editLineageRoot,
    undoPreview,
    undoEdit,
    getEditHistory,
    buildExport,
    setPipelinePb,
  ]);
}

export default useLocalBackend;
