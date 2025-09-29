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
    const fetchLineageData = async () => {
      if (!backendUrl) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        console.log('=== FETCHING FULL LINEAGE DATA ===');
        console.log('Backend URL:', backendUrl);
        console.log('Field:', field);

        const url = `${backendUrl}/lineages?field=${encodeURIComponent(field)}`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: LineageResponse = await response.json();

        console.log(`Loaded ${data.lineages.length} unique lineages from ${data.totalNodes} total nodes`);
        console.log('First 10 lineages:', data.lineages.slice(0, 10));

        setLineageData(data.lineages);
        setStats({
          totalNodes: data.totalNodes,
          nodesWithLineage: data.nodesWithLineage,
          uniqueLineages: data.uniqueLineages
        });

        console.log('=================================');
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
  }, [backendUrl, field, refreshTrigger]);

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