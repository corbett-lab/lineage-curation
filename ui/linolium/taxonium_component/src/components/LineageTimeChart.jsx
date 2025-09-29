import React, { useState, useEffect } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, Legend, ResponsiveContainer 
} from 'recharts';

// Ultra-simplified version with no recursion or complex processing
const LineageTimeChart = ({ 
  data, 
  hierarchyData, 
  xType = 'x_time', 
  maxDepth = 3, 
  selectedCategory = null,
  getLineageColor
}) => {
  const [currentDepth, setCurrentDepth] = useState(0);
  const [lineages, setLineages] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [lineageColors, setLineageColors] = useState({});
  const [error, setError] = useState(null);

  // Extract top-level lineages on mount and when dependencies change
  useEffect(() => {
    try {
      console.log("------- LINEAGE EXTRACTION -------");
      console.log("Data sources:", {
        hierarchyData: hierarchyData ? {
          type: typeof hierarchyData,
          isArray: Array.isArray(hierarchyData),
          length: hierarchyData?.length || 0,
          firstItem: hierarchyData?.[0] ? { 
            name: hierarchyData[0].name,
            hasChildren: !!hierarchyData[0].children
          } : null
        } : null,
        currentDepth,
        selectedCategory
      });
      
      // Clear any previous errors
      setError(null);
      
      // Simple array to store lineages at each depth
      const allLineagesByDepth = {};
      const flatNodes = [];
      
      // Basic validation
      if (!hierarchyData || !Array.isArray(hierarchyData) || hierarchyData.length === 0) {
        console.warn("No hierarchy data available for lineage extraction");
        setError("No lineage hierarchy data available");
        return;
      }
      
      // Function to extract lineages without recursion
      function extractLineages() {
        // First flatten the hierarchy using iterative BFS (Breadth-First Search)
        const queue = hierarchyData.map(node => ({ node, depth: 0, path: [] }));
        const visited = new Set(); // To track visited nodes and avoid cycles
        
        // Process nodes level by level - no recursion
        while (queue.length > 0) {
          const { node, depth, path } = queue.shift();
          
          // Skip invalid nodes or already processed nodes
          if (!node || !node.name) continue;
          
          // Use node reference to avoid duplicates
          const nodeId = node.id || node.name;
          if (visited.has(nodeId)) continue;
          visited.add(nodeId);
          
          // Store this node's info
          flatNodes.push({
            name: node.name,
            depth: depth,
            path: [...path, node.name]
          });
          
          // Add to lineages by depth
          if (!allLineagesByDepth[depth]) {
            allLineagesByDepth[depth] = [];
          }
          if (!allLineagesByDepth[depth].includes(node.name)) {
            allLineagesByDepth[depth].push(node.name);
          }
          
          // Enqueue children for next level
          if (node.children && Array.isArray(node.children)) {
            for (const child of node.children) {
              if (child && child.name) {
                queue.push({ 
                  node: child, 
                  depth: depth + 1,
                  path: [...path, node.name]
                });
              }
            }
          }
        }
      }
      
      // Extract all lineages on load
      extractLineages();
      
      // Debug what we found
      console.log("Lineages by depth:", Object.keys(allLineagesByDepth).map(depth => 
        `Depth ${depth}: ${allLineagesByDepth[depth]?.length || 0} lineages`
      ));
      
      // Get lineages for current view
      let selectedLineages = [];
      
      if (selectedCategory) {
        console.log(`Extracting sub-lineages for ${selectedCategory} at depth ${currentDepth}`);
        
        // For selected category, find direct children at appropriate depth
        // Use the flat structure to avoid recursion
        
        // Find the node for our selected category first
        const selectedNode = flatNodes.find(node => node.name === selectedCategory);
        if (!selectedNode) {
          console.warn(`Selected category "${selectedCategory}" not found in hierarchy`);
          setLineages([selectedCategory]); // Fall back to just the selected category
          return;
        }
        
        const selectedDepth = selectedNode.depth;
        const targetDepth = selectedDepth + currentDepth;
        
        console.log(`Looking for nodes at depth ${targetDepth} that are descendants of ${selectedCategory}`);
        
        // Find all descendants of selected category at the target depth
        selectedLineages = flatNodes
          .filter(node => {
            // Must be at the target depth
            if (node.depth !== targetDepth) return false;
            
            // Must have the selected category in its path
            return node.path.includes(selectedCategory);
          })
          .map(node => node.name);
        
        console.log(`Found ${selectedLineages.length} descendants at depth ${targetDepth}`);
        
        // If no descendants found, use the selected category itself
        if (selectedLineages.length === 0) {
          console.log("No descendants found, using selected category itself");
          selectedLineages = [selectedCategory];
        }
      } else {
        // Just get lineages at current depth
        selectedLineages = allLineagesByDepth[currentDepth] || [];
        console.log(`Using ${selectedLineages.length} lineages at depth ${currentDepth}`);
      }
      
      // Limit to top 10 to prevent performance issues
      if (selectedLineages.length > 10) {
        console.log(`Limiting from ${selectedLineages.length} to 10 lineages for performance`);
        selectedLineages = selectedLineages.slice(0, 10);
      }
      
      // Make sure we have at least something to display
      if (!selectedLineages.length && Object.keys(allLineagesByDepth).length > 0) {
        // Try to find the closest depth that has lineages
        const availableDepths = Object.keys(allLineagesByDepth)
          .map(Number)
          .filter(depth => allLineagesByDepth[depth].length > 0)
          .sort((a, b) => Math.abs(a - currentDepth) - Math.abs(b - currentDepth));
        
        if (availableDepths.length > 0) {
          const closestDepth = availableDepths[0];
          console.log(`No lineages at depth ${currentDepth}, using ${allLineagesByDepth[closestDepth].length} lineages from closest depth ${closestDepth}`);
          selectedLineages = allLineagesByDepth[closestDepth].slice(0, 10);
        }
      }
      
      setLineages(selectedLineages);
    } catch (err) {
      console.error("Error extracting lineages:", err);
      setError(`Failed to extract lineages: ${err.message}`);
    }
  }, [hierarchyData, currentDepth, selectedCategory]);
  
  // Create chart data from lineages
  useEffect(() => {
    if (!data || !data.nodes || !Array.isArray(lineages) || lineages.length === 0) {
      console.log("------- CHART DATA CREATION SKIPPED -------");
      console.log("Missing required data:", {
        hasData: !!data,
        hasNodes: !!(data?.nodes),
        nodesLength: data?.nodes?.length || 0,
        lineagesValid: Array.isArray(lineages),
        lineagesLength: lineages?.length || 0
      });
      return;
    }
    
    try {
      // Add debugging
      console.log("------- CHART DATA CREATION -------");
      console.log("Data sources:", {
        xType,
        nodeCount: data.nodes.length,
        lineages: lineages.length,
        firstNodeProperties: data.nodes[0] ? Object.keys(data.nodes[0]) : [],
        firstNodeSample: data.nodes[0] ? {
          time: data.nodes[0][xType],
          lineageFields: Object.keys(data.nodes[0]).filter(k => k.includes('lineage')),
          meta: data.nodes[0].meta ? Object.keys(data.nodes[0].meta) : null
        } : null
      });
      
      // Clear any previous errors
      setError(null);
      
      // Simple throttling to prevent excessive processing
      const maxNodesToProcess = 5000;
      const nodesToProcess = data.nodes.length > maxNodesToProcess ? 
        data.nodes.slice(0, maxNodesToProcess) : data.nodes;
      
      if (data.nodes.length > maxNodesToProcess) {
        console.log(`Processing limited to ${maxNodesToProcess} of ${data.nodes.length} nodes`);
      }
      
      // Basic timepoint buckets
      const buckets = [];
      
      // Get valid time values with better error handling
      const timePoints = [];
      let actualXType = xType; // Local variable to potentially change
      
      // Efficiently collect time points in a single pass
      for (const node of nodesToProcess) {
        if (node && node[actualXType] !== undefined && Number.isFinite(node[actualXType])) {
          timePoints.push(node[actualXType]);
        }
      }
      
      if (timePoints.length === 0) {
        console.warn(`No valid time points found for xType: ${actualXType}`);
        
        // Try to find an alternative time property if the specified one doesn't exist
        const potentialTimeProps = ['x_dist', 'x_time', 'div', 'num_date'];
        let alternativeFound = false;
        
        for (const prop of potentialTimeProps) {
          if (prop !== actualXType) {
            // Count valid points without creating a large array
            let validPointCount = 0;
            
            // Just check a sample of nodes
            const sampleSize = Math.min(nodesToProcess.length, 100);
            for (let i = 0; i < sampleSize; i++) {
              const node = nodesToProcess[i];
              if (node && node[prop] !== undefined && Number.isFinite(node[prop])) {
                validPointCount++;
                if (validPointCount >= 10) break; // Found enough valid points
              }
            }
            
            if (validPointCount >= 10) {
              console.log(`Found alternative time property: ${prop} with ${validPointCount}+ points`);
              actualXType = prop; // Use the alternative property
              
              // Now collect all points with this property
              for (const node of nodesToProcess) {
                if (node && node[prop] !== undefined && Number.isFinite(node[prop])) {
                  timePoints.push(node[prop]);
                }
              }
              
              alternativeFound = true;
              break;
            }
          }
        }
        
        if (!alternativeFound) {
          setError("No valid time points found for any known time property");
          return;
        }
      }
      
      // Safety check
      if (timePoints.length === 0) {
        setError("No valid time data found");
        return;
      }
      
      // Get min/max time
      const minTime = Math.min(...timePoints);
      const maxTime = Math.max(...timePoints);
      
      console.log("Time range:", {minTime, maxTime, points: timePoints.length});
      
      if (minTime === maxTime || !Number.isFinite(minTime) || !Number.isFinite(maxTime)) {
        setError("Invalid time range detected");
        return;
      }
      
      // Create fixed number of buckets (linear binning)
      const numBuckets = 10;
      const bucketSize = (maxTime - minTime) / numBuckets;
      
      // Exit if bucket size is invalid
      if (!Number.isFinite(bucketSize) || bucketSize <= 0) {
        setError("Could not create valid time buckets");
        return;
      }
      
      // Prepare lineage matching patterns once (outside loop)
      const lineagePatterns = lineages.map(lineage => ({
        lineage,
        // Pre-compute with dot to prevent false matches (e.g. B vs BA)
        exactMatch: lineage,
        childPrefix: lineage + '.'
      }));
      
      // Process each bucket
      for (let i = 0; i < numBuckets; i++) {
        const startTime = minTime + (i * bucketSize);
        const endTime = minTime + ((i + 1) * bucketSize);
        const midTime = (startTime + endTime) / 2;
        
        // Find nodes in this time bucket
        const nodesInBucket = [];
        for (const node of nodesToProcess) {
          if (node && 
              node[actualXType] !== undefined && 
              Number.isFinite(node[actualXType]) &&
              node[actualXType] >= startTime && 
              node[actualXType] < endTime) {
            nodesInBucket.push(node);
          }
        }
        
        if (nodesInBucket.length === 0) continue;
        
        // Count lineage occurrences
        const counts = {};
        lineages.forEach(lineage => { counts[lineage] = 0; });
        
        let totalNodes = 0;
        
        // Log progress for the first bucket only to avoid flooding console
        if (i === 0) {
          console.log(`Processing bucket ${i+1}/${numBuckets} with ${nodesInBucket.length} nodes`);
          console.log("Lineage fields examination on sample node:", 
            nodesInBucket[0] ? {
              hasLineageField: !!nodesInBucket[0].lineage || !!nodesInBucket[0].meta_pangolin_lineage,
              lineageValue: nodesInBucket[0].lineage || nodesInBucket[0].meta_pangolin_lineage,
              allFields: Object.keys(nodesInBucket[0]).filter(k => k.includes('lineage'))
            } : "No nodes in bucket"
          );
        }
        
        // Process nodes in bucket without recursive calls
        for (const node of nodesInBucket) {
          let nodeLineage = null;
          
          // Check common fields non-recursively
          const lineageFields = ['meta_pangolin_lineage', 'lineage', 'meta_lineage', 'pangolin_lineage'];
          for (let j = 0; j < lineageFields.length; j++) {
            const field = lineageFields[j];
            if (node && node[field]) {
              nodeLineage = node[field];
              break;
            }
          }
          
          // If still no lineage found, check metadata non-recursively
          if (!nodeLineage && node && node.meta) {
            for (const key in node.meta) {
              if (key.toLowerCase().includes('lineage') && node.meta[key]) {
                nodeLineage = node.meta[key];
                break;
              }
            }
          }
          
          // No lineage, skip this node
          if (!nodeLineage) continue;
          
          totalNodes++;
          
          // Match with our target lineages
          let matched = false;
          for (let j = 0; j < lineagePatterns.length; j++) {
            const { lineage, exactMatch, childPrefix } = lineagePatterns[j];
            
            // Direct match or starts with prefix
            if (nodeLineage === exactMatch || nodeLineage.startsWith(childPrefix)) {
              counts[lineage]++;
              matched = true;
              break;
            }
          }
        }
        
        // Skip if no nodes with lineages
        if (totalNodes === 0) continue;
        
        // Create data point 
        const dataPoint = {
          time: midTime,
          timeLabel: formatTimeLabel(midTime, actualXType),
        };
        
        // Add percentages for each lineage
        let hasData = false;
        for (const lineage of lineages) {
          if (!lineage) continue;
          
          const count = counts[lineage] || 0;
          const percentage = (count / totalNodes) * 100;
          
          if (Number.isFinite(percentage)) {
            dataPoint[lineage] = percentage;
            if (percentage > 0) hasData = true;
          } else {
            dataPoint[lineage] = 0;
          }
        }
        
        // Only add points with actual data
        if (hasData) {
          buckets.push(dataPoint);
        }
      }
      
      // Sort by time
      buckets.sort((a, b) => a.time - b.time);
      
      if (buckets.length === 0) {
        console.warn("No buckets created with data");
        setError("No lineage data could be found for the selected time range");
        return;
      }
      
      console.log(`Created ${buckets.length} data points for the chart`);
      setChartData(buckets);
    } catch (err) {
      console.error("Error creating chart data:", err);
      setError(`Failed to create chart data: ${err.message}`);
    }
  }, [data, lineages, xType]);
  
  // Generate lineage colors
  useEffect(() => {
    try {
      const colors = {};
      
      // Simple hash function for color generation
      const generateHashColor = (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          hash = ((hash << 5) - hash) + str.charCodeAt(i);
          hash = hash & hash; // Convert to 32bit integer
        }
        
        // Generate CSS RGB color string with better distribution
        // Use HSL color space for more distinct colors
        const h = Math.abs(hash) % 360;
        const s = 65 + (Math.abs(hash >> 8) % 25); // 65-90% saturation
        const l = 45 + (Math.abs(hash >> 16) % 15); // 45-60% lightness - not too dark or bright
        
        return `hsl(${h}, ${s}%, ${l}%)`;
      };
      
      // Pre-defined colors for common top-level lineages for consistency
      const predefinedColors = {
        'A': 'hsl(0, 80%, 50%)',     // Red
        'B': 'hsl(210, 80%, 50%)',   // Blue
        'BA': 'hsl(270, 80%, 50%)',  // Purple
        'XBB': 'hsl(160, 80%, 50%)', // Teal
        'JN': 'hsl(30, 80%, 50%)',   // Orange
        'EG': 'hsl(120, 70%, 35%)'   // Green
      };
      
      // Assign colors to lineages
      for (const lineage of lineages) {
        if (!lineage) continue;
        
        try {
          // 1. Use predefined color if available
          if (predefinedColors[lineage]) {
            colors[lineage] = predefinedColors[lineage];
            continue;
          }
          
          // 2. Use color function if provided
          if (typeof getLineageColor === 'function') {
            try {
              const rgb = getLineageColor(lineage);
              if (Array.isArray(rgb) && rgb.length >= 3) {
                // Check if values are in 0-255 range (RGB) or 0-1 range (normalized)
                if (rgb.some(v => v > 1)) {
                  colors[lineage] = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
                } else {
                  colors[lineage] = `rgb(${Math.round(rgb[0]*255)}, ${Math.round(rgb[1]*255)}, ${Math.round(rgb[2]*255)})`;
                }
                continue;
              }
            } catch (e) {
              console.log(`Error getting color for ${lineage}:`, e);
            }
          }
          
          // 3. Check if this is a sub-lineage and derive color from parent
          const parentLineage = lineage.includes('.') ? 
            lineage.substring(0, lineage.lastIndexOf('.')) : 
            (lineage.length > 1 ? lineage.substring(0, 1) : null);
          
          if (parentLineage && colors[parentLineage]) {
            // Derive a slightly different color from parent
            // Extract HSL values from parent color if it's in HSL format
            const hslMatch = colors[parentLineage].match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
            if (hslMatch) {
              const [_, h, s, l] = hslMatch.map(Number);
              // Slight variation of the parent color
              const newH = (h + 15) % 360;
              const newS = Math.min(100, s + 5);
              const newL = Math.max(35, Math.min(65, l + (lineage.length % 2 === 0 ? 10 : -10)));
              colors[lineage] = `hsl(${newH}, ${newS}%, ${newL}%)`;
              continue;
            }
          }
          
          // 4. Fall back to hash-based color
          colors[lineage] = generateHashColor(lineage);
        } catch (e) {
          console.error(`Error generating color for ${lineage}:`, e);
          colors[lineage] = '#888888'; // Default gray
        }
      }
      
      console.log("Generated colors for", Object.keys(colors).length, "lineages");
      setLineageColors(colors);
    } catch (err) {
      console.error("Error in color generation:", err);
      // Don't set error state here, as it's not critical for functionality
    }
  }, [lineages, getLineageColor]);
  
  // Helper function for time formatting
  const formatTimeLabel = (time, xType) => {
    try {
      if (xType === 'x_time' && time > 1000000000) {
        // Unix timestamp conversion - handle browser differences
        return new Date(time * 1000).toLocaleDateString();
      }
      
      // For numerical values, just round to 2 decimal places
      return Number(time).toFixed(2);
    } catch (err) {
      console.error("Error formatting time label:", err);
      return time?.toString() || "?"; // Safely convert to string
    }
  };
  
  // Show errors if any
  if (error) {
    return (
      <div className="p-4 border rounded bg-red-50 text-red-700">
        Error: {error}
      </div>
    );
  }
  
  // Show loading state if no data
  if (!chartData.length) {
    return (
      <div className="p-4 border rounded bg-gray-50 text-gray-500 text-center">
        {!data ? "No data available" :
         !hierarchyData ? "No hierarchy data" :
         !lineages.length ? "No lineages found" :
         "Preparing chart data..."}
      </div>
    );
  }
  
  // Render chart
  return (
    <div className="lineage-time-chart">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">
          Lineage Prevalence Over {xType === 'x_time' ? 'Time' : 'Distance'}
        </h3>
        <select 
          className="text-xs p-1 border rounded"
          value={currentDepth}
          onChange={(e) => setCurrentDepth(parseInt(e.target.value, 10))}
        >
          {Array.from({length: maxDepth + 1}, (_, i) => (
            <option key={i} value={i}>
              Depth {i}{i === 0 ? ' (Top level)' : ''}
            </option>
          ))}
        </select>
      </div>
      
      {/* Chart container */}
      <div className="chart-container border rounded p-2" style={{height: 280}}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart 
            data={chartData} 
            margin={{top: 5, right: 5, left: 0, bottom: 25}}
          >
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis 
              dataKey="timeLabel" 
              angle={-45} 
              textAnchor="end" 
              height={60} 
              tick={{fontSize: 10}}
            />
            <YAxis 
              label={{value: 'Prevalence (%)', angle: -90, position: 'insideLeft', fontSize: 10}} 
              tick={{fontSize: 10}}
              domain={[0, 'auto']}
            />
            <Tooltip
              formatter={(value, name) => {
                // Safely format value and protect against bad data
                try {
                  return [
                    (Number.isFinite(value) ? value.toFixed(1) : '?') + '%', 
                    name || 'Lineage'
                  ];
                } catch (err) {
                  console.error("Tooltip format error:", err);
                  return ['?%', name || 'Lineage'];
                }
              }}
              labelFormatter={(label) => `Time: ${label || '?'}`}
              isAnimationActive={false}
            />
            <Legend 
              wrapperStyle={{fontSize: 10, marginTop: 5}} 
              layout="horizontal"
              verticalAlign="bottom"
              align="center"
            />
            
            {/* Ensure lineages array is valid and has elements */}
            {Array.isArray(lineages) && lineages.length > 0 && 
              lineages.map(lineage => lineage && (
                <Line
                  key={lineage}
                  type="monotone"
                  dataKey={lineage}
                  name={lineage}
                  stroke={lineageColors[lineage] || '#888'}
                  dot={{r: 2}}
                  activeDot={{r: 5}}
                  strokeWidth={1.5}
                  connectNulls={true}
                  isAnimationActive={false}
                />
              ))
            }
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      <div className="mt-2 text-xs text-gray-500">
        {selectedCategory ? 
          `Showing sub-lineages of ${selectedCategory} at depth ${currentDepth}` : 
          `Showing lineages at depth ${currentDepth}`}
      </div>
    </div>
  );
};

export default LineageTimeChart; 