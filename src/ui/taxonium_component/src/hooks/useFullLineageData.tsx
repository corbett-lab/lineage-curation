import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Backend } from '../types/backend';

interface LineageItem {
  value: string;
  count: number;
  descendantLineages: number;
  descendantLeaves: number;
}

interface LineageResponse {
  lineages: LineageItem[];
  field: string;
  totalNodes: number;
  nodesWithLineage: number;
  uniqueLineages: number;
}

interface UseFullLineageDataReturn {
  lineageData: LineageItem[];
  isLoading: boolean;
  error: string | null;
  totalNodes: number;
  nodesWithLineage: number;
  uniqueLineages: number;
  refreshData: () => void;
}

/**
 * Hook to fetch complete lineage data from the backend /lineages endpoint
 * This gives us all lineage values from the full dataset, not just the viewport
 */
const useFullLineageData = (
  backend: Backend,
  field: string = 'meta_annotation_1'
): UseFullLineageDataReturn => {
  const [lineageData, setLineageData] = useState<LineageItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [stats, setStats] = useState({
    totalNodes: 0,
    nodesWithLineage: 0,
    uniqueLineages: 0
  });

  // Memoize the backend URL to avoid unnecessary re-fetches
  const backendUrl = useMemo(() => {
    if (backend?.type === 'server' && backend.backend_url) {
      return backend.backend_url;
    }
    return null;
  }, [backend]);

  useEffect(() => {
    const applyData = (data: LineageResponse) => {
      setLineageData(data.lineages);
      setStats({
        totalNodes: data.totalNodes,
        nodesWithLineage: data.nodesWithLineage,
        uniqueLineages: data.uniqueLineages,
      });
    };

    const fetchLineageData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Local (backendless) path: the worker computes the lineage hierarchy
        // in-memory from the same node array it already holds.
        if (backend?.type === 'local' && typeof backend.getLineages === 'function') {
          const data = (await backend.getLineages(field)) as LineageResponse;
          applyData(data);
          return;
        }

        if (!backendUrl) {
          setIsLoading(false);
          return;
        }

        const url = `${backendUrl}/lineages?field=${encodeURIComponent(field)}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data: LineageResponse = await response.json();
        applyData(data);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('Error fetching lineage data:', errorMessage);
        setError(errorMessage);
        setLineageData([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchLineageData();
  }, [backend, backendUrl, field, refreshTrigger]);

  // Function to manually refresh the data
  const refreshData = useCallback(() => {
    console.log('Manually refreshing lineage data...');
    console.log('Previous refresh trigger:', refreshTrigger);
    setRefreshTrigger(prev => {
      const newTrigger = prev + 1;
      console.log('New refresh trigger:', newTrigger);
      return newTrigger;
    });
  }, [refreshTrigger]);

  return {
    lineageData,
    isLoading,
    error,
    refreshData,
    ...stats
  };
};

export default useFullLineageData;