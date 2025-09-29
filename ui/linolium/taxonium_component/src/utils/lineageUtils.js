/**
 * Utility functions for handling Pango lineage data
 */

/**
 * Check if a category name appears to be a Pango lineage
 * @param {string} name - The category name to check
 * @returns {boolean} True if the name follows Pango lineage format
 */
export const isPangoLineage = (name) => {
  if (!name) return false;
  
  // Enhanced pattern to handle various lineage formats:
  // - Single letters: A, B, C
  // - Multi-letter roots: BA, AY, XBB
  // - With numeric parts: B.1, AY.4, XBB.1.5
  // - Recombinants: X, XA, XBB.1.5
  return /^[A-Za-z]+(\.\d+)*$/.test(name);
};

/**
 * Parses a Pango lineage name to determine its hierarchical structure
 * @param {string} lineageName - The Pango lineage name (e.g., "B.1.1.7")
 * @returns {object} Object with parts array and parent lineage name
 */
export const parseLineageName = (lineageName) => {
  if (!lineageName) return { parts: [], parent: null };
  
  // Handle multi-letter root lineages (AY, BA, XBB, etc.)
  let parts;
  let parent = null;
  
  // Special handling for multi-letter root lineages
  if (/^[A-Z]{2,}($|\.)/.test(lineageName)) {
    const dotIndex = lineageName.indexOf('.');
    if (dotIndex > 0) {
      // Multi-letter root with children (e.g., "AY.4")
      const rootPart = lineageName.substring(0, dotIndex);
      const numericParts = lineageName.substring(dotIndex + 1).split('.');
      parts = [rootPart, ...numericParts];
      
      // For "AY.4", parent is "AY"
      parent = rootPart;
      
      // For "AY.4.2", parent is "AY.4"
      if (numericParts.length > 1) {
        parent = rootPart + '.' + numericParts.slice(0, numericParts.length - 1).join('.');
      }
    } else {
      // Just the root lineage (e.g., "AY")
      parts = [lineageName];
      parent = null;
    }
  } else {
    // Standard lineage handling (e.g., "B.1.1.7")
    parts = lineageName.split('.');
    parent = parts.length > 1 
      ? parts.slice(0, parts.length - 1).join('.') 
      : null;
  }
  
  return { parts, parent };
};

/**
 * Normalizes lineage names for hierarchical coloring by mapping normal lineages into auto hierarchy
 * @param {string} name - The lineage name to normalize
 * @returns {string} The normalized lineage name
 */
const normalizeLineageForColoring = (name) => {
  return name;
};

/**
 * Organizes lineage data into a hierarchical structure based on Pango naming
 * @param {Array} lineages - Array of lineage objects with value, count, and color properties
 * @param {Object} nodeTypes - Optional object with node type information (internal vs leaf)
 * @returns {Array} Hierarchical structure of lineages
 */
export const organizeLineageHierarchy = (lineages, nodeTypes = null) => {
  if (!lineages || !lineages.length) return [];
  
  // First, merge normal lineages into auto hierarchy
  const mergedLineages = [];
  const mergeMap = {}; // Map to track merged lineages
  
  // Process each lineage and merge if necessary
  lineages.forEach(lineage => {
    if (!lineage.value) {
      mergedLineages.push(lineage);
      return;
    }
    
    // Check if this is a normal lineage that should be merged into auto
    const normalizedName = normalizeLineageForColoring(lineage.value, lineages.map(l => l.value));
    
    if (normalizedName !== lineage.value) {
      // This lineage should be merged into the normalized version
      if (mergeMap[normalizedName]) {
        // Add counts to existing merged lineage
        mergeMap[normalizedName].count += lineage.count;
      } else {
        // Create new merged lineage entry
        mergeMap[normalizedName] = {
          ...lineage,
          value: normalizedName,
        };
      }
    } else {
      // This lineage doesn't need merging, but check if it's a target of merging
      if (mergeMap[lineage.value]) {
        // Add counts to existing merged lineage
        mergeMap[lineage.value].count += lineage.count;
      } else {
        // Create new entry
        mergeMap[lineage.value] = { ...lineage };
      }
    }
  });
  
  // Convert mergeMap back to array
  const processedLineages = Object.values(mergeMap);
  
  console.log('=== LINEAGE MERGING ===');
  console.log('Original lineages:', lineages.length);
  console.log('Merged lineages:', processedLineages.length);
  console.log('Sample merges:');
  processedLineages.slice(0, 10).forEach(l => {
    const original = lineages.find(orig => orig.value === l.value);
    if (!original) {
      console.log(`  ${l.value} (merged from multiple sources)`);
    }
  });
  console.log('=======================');
  
  // Create a map for quick access to lineages by name
  const lineageMap = {};
  
  // Helper to get all possible parent lineages from a lineage name
  // e.g., "B.1.1.7" -> ["B", "B.1", "B.1.1"]
  const getAllParentLineages = (lineageName) => {
    if (!lineageName) return [];
    
    // Handle special cases for multi-letter root lineages
    let parts;
    if (/^[A-Z]{2,}($|\.)/.test(lineageName)) {
      // This is a multi-letter root lineage like "AY" or "AY.4"
      const dotIndex = lineageName.indexOf('.');
      if (dotIndex > 0) {
        // Split into root + numeric parts, e.g., "AY.4.3" -> ["AY", "4", "3"]
        const rootPart = lineageName.substring(0, dotIndex);
        const numericParts = lineageName.substring(dotIndex + 1).split('.');
        parts = [rootPart, ...numericParts];
      } else {
        // Just the root like "AY" or "XBB"
        parts = [lineageName];
      }
    } else {
      // Regular lineage like "B.1.1.7"
      parts = lineageName.split('.');
    }
    
    const parents = [];
    
    // Build parent names from parts
    let currentParent = parts[0];
    parents.push(currentParent);
    
    for (let i = 1; i < parts.length; i++) {
      currentParent += `.${parts[i]}`;
      parents.push(currentParent);
    }
    
    // Remove the last one as it's the lineage itself
    parents.pop();
    
    return parents;
  };
  
  // First pass: Create nodes for all lineages that appear in the data
  processedLineages.forEach(lineage => {
    if (!lineage.value) return;
    
    if (!lineageMap[lineage.value]) {
      // Determine if the count represents leaf nodes, internal nodes, or both
      const isLeafCount = !nodeTypes || !nodeTypes[lineage.value] || nodeTypes[lineage.value] === 'leaf';
      
      lineageMap[lineage.value] = {
        name: lineage.value,
        count: lineage.count, // Total count will be recalculated
        originalCount: lineage.count, // Direct count for this lineage
        sampleCount: isLeafCount ? lineage.count : 0, // Count of actual samples (leaves)
        internalCount: isLeafCount ? 0 : lineage.count, // Count of internal nodes
        color: generatePangoLineageColor(lineage.value, processedLineages),
        children: [],
        isExpanded: false,
        level: getLineageLevel(lineage.value)
      };
    }
    
    // Note: We no longer create artificial parent lineages that don't exist in the data
    // Only lineages that actually have clade nodes in the tree should be included
  });
  
  // Second pass: Build the hierarchy and accumulate counts
  const rootLineages = [];
  
  // Link children to parents and accumulate counts
  Object.values(lineageMap).forEach(node => {
    const { parent } = parseLineageName(node.name);
    
    if (!parent) {
      // This is a root-level lineage (e.g., "A", "B", "AY")
      rootLineages.push(node);
    } else if (lineageMap[parent]) {
      // Add as a child to its parent
      lineageMap[parent].children.push(node);
      // Add reference to parent for child nodes to support percentages
      node.parent = lineageMap[parent];
    } else {
      // Parent doesn't exist in our data, add to root
      rootLineages.push(node);
    }
  });
  
  // Third pass: Recursive function to accumulate counts from children
  const accumulateChildCounts = (node) => {
    if (!node.children || node.children.length === 0) {
      // For leaf nodes in the hierarchy, return various counts
      return {
        totalCount: node.originalCount,
        sampleCount: node.sampleCount,
        internalCount: node.internalCount
      };
    }
    
    // Accumulate counts from all children
    let totalChildrenCount = 0;
    let totalSampleCount = node.sampleCount; // Start with this node's own sample count
    let totalInternalCount = node.internalCount; // Start with this node's own internal count
    
    for (const child of node.children) {
      const childCounts = accumulateChildCounts(child);
      totalChildrenCount += childCounts.totalCount;
      totalSampleCount += childCounts.sampleCount;
      totalInternalCount += childCounts.internalCount;
    }
    
    // Update node's counts
    node.count = node.originalCount + totalChildrenCount; // Total count including children
    node.sampleCount = totalSampleCount; // Total sample (leaf) count including children
    node.internalCount = totalInternalCount; // Total internal node count including children
    node.totalTaxa = totalSampleCount + totalInternalCount; // Total taxa (leaves + internal nodes)
    
    return {
      totalCount: node.count,
      sampleCount: totalSampleCount,
      internalCount: totalInternalCount
    };
  };
  
  // Apply count accumulation to all root lineages
  rootLineages.forEach(accumulateChildCounts);
  
  // Sort children by total count (including child counts) descending
  const sortByCount = (a, b) => b.count - a.count;
  
  const sortChildren = (node) => {
    if (node.children && node.children.length > 0) {
      node.children.sort(sortByCount);
      node.children.forEach(sortChildren);
    }
  };
  
  rootLineages.sort(sortByCount);
  rootLineages.forEach(sortChildren);
  
  return rootLineages;
};

/**
 * Get the level of a lineage in the Pango hierarchy
 * @param {string} lineageName - The Pango lineage name (e.g., "B.1.1.7")
 * @returns {number} The hierarchy level (0 for A/B, 1 for A.1/B.1, etc.)
 */
export const getLineageLevel = (lineageName) => {
  if (!lineageName) return 0;
  
  // Handle multi-letter root lineages (AY, BA, XBB, etc.)
  if (/^[A-Z]{2,}($|\.)/.test(lineageName)) {
    if (lineageName.indexOf('.') === -1) {
      // Just a root like "AY" or "XBB" - level 0
      return 0;
    } else {
      // Count dots for level beyond the root
      return lineageName.split('.').length - 1;
    }
  }
  
  // Standard processing for regular lineages
  const { parts } = parseLineageName(lineageName);
  return parts.length - 1;
};

/**
 * Check if a lineage is a direct child of another lineage
 * @param {string} childLineage - The potential child lineage (e.g., "B.1.1")
 * @param {string} parentLineage - The potential parent lineage (e.g., "B.1")
 * @returns {boolean} True if childLineage is a direct child of parentLineage
 */
export const isDirectChild = (childLineage, parentLineage) => {
  if (!childLineage || !parentLineage) return false;
  
  // Special handling for multi-letter lineages
  if (/^[A-Z]{2,}($|\.)/.test(childLineage)) {
    // Get the correct parts using extractLineageRoot
    const { rootLineage: childRoot, nameParts: childParts } = extractLineageRoot(childLineage);
    const { rootLineage: parentRoot, nameParts: parentParts } = extractLineageRoot(parentLineage);
    
    // For multi-letter lineages, the parent must be the same root
    // And child must have exactly one more level
    if (childRoot !== parentRoot) {
      return false;
    }
    
    return childParts.length === parentParts.length + 1 &&
           childParts.slice(0, parentParts.length).join('.') === parentParts.join('.');
  }
  
  // Standard lineage handling
  const childParts = parseLineageName(childLineage).parts;
  const parentParts = parseLineageName(parentLineage).parts;
  
  // Direct child has exactly one more part than parent
  if (childParts.length !== parentParts.length + 1) return false;
  
  // All parent parts must match the beginning of the child parts
  for (let i = 0; i < parentParts.length; i++) {
    if (parentParts[i] !== childParts[i]) return false;
  }
  
  return true;
};



/**
 * Determines the root lineage component for a given Pango lineage name
 * @param {string} lineageName - The Pango lineage name (e.g., "B.1.1.7", "AY.4", "XBB.1.5")
 * @returns {object} Object with rootLineage and nameParts
 */
export const extractLineageRoot = (lineageName) => {
  if (!lineageName) return { rootLineage: null, nameParts: [] };
  
  let rootLineage, nameParts;
  
  // Handle recombinant lineages (X lineages)
  if (lineageName.startsWith('X')) {
    // Recombinants get special treatment
    if (lineageName.length > 1 && lineageName.indexOf('.') > 0) {
      // Something like XA.1 or XBB.1.5
      const dotIndex = lineageName.indexOf('.');
      rootLineage = lineageName.substring(0, dotIndex);
      nameParts = [rootLineage, ...lineageName.substring(dotIndex + 1).split('.')];
    } else if (lineageName.length > 1) {
      // Something like XA, XBB (no dot)
      rootLineage = lineageName;
      nameParts = [rootLineage];
    } else {
      // Just X (unlikely)
      rootLineage = lineageName;
      nameParts = [rootLineage];
    }
  }
  // Handle 2-letter root lineages like BA, BQ, AY, etc.
  else if (/^[A-Z]{2,}($|\.)/.test(lineageName)) {
    // Multi-letter root like BA.2, AY.4, etc.
    const dotIndex = lineageName.indexOf('.');
    if (dotIndex > 0) {
      rootLineage = lineageName.substring(0, dotIndex);
      nameParts = [rootLineage, ...lineageName.substring(dotIndex + 1).split('.')];
    } else {
      // Just BA, BQ, AY, etc. with no dot
      rootLineage = lineageName;
      nameParts = [rootLineage];
    }
  } 
  // Standard single-letter root lineages (A, B)
  else {
    const parts = lineageName.split('.');
    rootLineage = parts[0];
    nameParts = parts;
  }
  
  return { rootLineage, nameParts };
};

// Global cache for hierarchical colors to improve performance
let __hierarchicalColorCache = {};
let __lastLineageDataHash = null;

/**
 * Clear the hierarchical color cache (useful when lineage data changes)
 */
export const clearHierarchicalColorCache = () => {
  __hierarchicalColorCache = {};
  __lastLineageDataHash = null;
};

/**
 * Generates a hierarchical color scheme for lineages using distinct hues and shades
 *
 * Algorithm:
 * 1. Use a set of distinct hues for top-level lineages
 * 2. Split from the root, using a new hue for each major branch
 * 3. When hues are exhausted, use shades of the parent hue for descendant lineages
 * 4. Maintain visual hierarchy through lightness and saturation variations
 *
 * @param {string} lineageName - The lineage name (e.g., "B.1.1.7")
 * @param {object|null} lineageData - Optional lineage data with count info for prevalence-based coloring
 * @returns {Array} RGB color array [r, g, b]
 */
export const generatePangoLineageColor = (lineageName, allLineageData = null) => {
  // Use global window variable if no data is passed (for caching scenario)
  if (!allLineageData && typeof window !== 'undefined' && (window).__taxoniumLineageData) {
    allLineageData = (window).__taxoniumLineageData;
  }
  
  // Check cache first
  if (__hierarchicalColorCache[lineageName]) {
    return __hierarchicalColorCache[lineageName];
  }
  if (!lineageName || typeof lineageName !== 'string') return [180, 180, 180];



  // 12 distinct base hues evenly distributed around the color wheel
  const baseHues = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

  // HSL to RGB conversion helper
  const hslToRgb = (h, s, l) => {
    h = h / 360;
    s = s / 100;
    l = l / 100;
    
    let r, g, b;
    
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  };

  // Simple hash function for deterministic color assignment when no data available
  const simpleHash = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  };

  // If no lineage data provided, use simple hash-based coloring
  if (!allLineageData || !Array.isArray(allLineageData)) {
    const hash = simpleHash(lineageName);
    const hue = baseHues[hash % baseHues.length];
    const result = hslToRgb(hue, 70, 50);
    __hierarchicalColorCache[lineageName] = result;
    return result;
  }

  // Extract all unique lineages from the data
  const allLineages = [...new Set(allLineageData.map(item => item.value || item))];
  
  // Normalize the lineage name for hierarchical coloring
  const normalizedLineageName = normalizeLineageForColoring(lineageName);
  
  // Build a hierarchical tree structure to understand sibling relationships using normalized names
  const buildLineageTree = () => {
    const tree = {};
    
    // Add each lineage to the tree, normalizing names to create unified hierarchy
    for (const lineage of allLineages) {
      const normalizedLineage = normalizeLineageForColoring(lineage);
      const parts = normalizedLineage.split('.');
      let current = tree;
      
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!current[part]) {
          current[part] = { 
            children: {},
            fullName: parts.slice(0, i + 1).join('.'),
            isLeaf: false
          };
        }
        current = current[part].children;
      }
      
      // Mark the final node as a leaf
      const leafPath = parts.slice(0, -1);
      let leafParent = tree;
      for (const part of leafPath) {
        leafParent = leafParent[part].children;
      }
      if (leafParent[parts[parts.length - 1]]) {
        leafParent[parts[parts.length - 1]].isLeaf = true;
      }
    }
    
    return tree;
  };

  const lineageTree = buildLineageTree();
  
  // Function to find all siblings at each level for a given lineage path
  const getSiblingGroupsAlongPath = (targetLineageName) => {
    const parts = targetLineageName.split('.');
    const siblingGroups = [];
    
    let current = lineageTree;
    let currentPath = [];
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath.push(part);
      
      // Get all siblings at this level (including self)
      const siblings = Object.keys(current).sort();
      
      if (siblings.length > 1) {
        // Only record this as a significant split if there are multiple siblings
        siblingGroups.push({
          level: i,
          siblings: siblings,
          selfIndex: siblings.indexOf(part),
          path: currentPath.join('.')
        });
      }
      
      // Move to the next level
      if (current[part] && current[part].children) {
        current = current[part].children;
      } else {
        break;
      }
    }
    
    return siblingGroups;
  };

  const siblingGroups = getSiblingGroupsAlongPath(normalizedLineageName);
  
  // Implement proper hierarchical hue splitting
  // Start with full hue range available
  let availableHues = [...baseHues];  // Copy of all 12 hues
  let assignedHue = null;
  let currentHueRange = availableHues;
  let huesExhausted = false;
  
  // Walk through each level and split hues among siblings
  for (let i = 0; i < siblingGroups.length && !huesExhausted; i++) {
    const group = siblingGroups[i];
    const numSiblings = group.siblings.length;
    
    if (currentHueRange.length >= numSiblings) {
      // We have enough hues to assign distinct ones to each sibling
      const hueIndex = group.selfIndex;
      assignedHue = currentHueRange[hueIndex % currentHueRange.length];
      
      // For next level, this lineage gets a subset of hues
      // Divide the hue range among siblings
      const huesPerSibling = Math.max(1, Math.floor(currentHueRange.length / numSiblings));
      const startIdx = hueIndex * huesPerSibling;
      const endIdx = Math.min(currentHueRange.length, startIdx + huesPerSibling);
      currentHueRange = currentHueRange.slice(startIdx, endIdx);
      
      if (currentHueRange.length === 0) {
        huesExhausted = true;
      }
    } else {
      // Not enough hues - reuse cyclically and mark as exhausted
      assignedHue = currentHueRange[group.selfIndex % currentHueRange.length];
      huesExhausted = true;
      break;
    }
  }
  
  // If no hue assigned yet (no sibling groups), assign based on root
  if (assignedHue === null) {
    const rootPart = lineageName.split('.')[0];
    const hash = simpleHash(rootPart);
    assignedHue = baseHues[hash % baseHues.length];
  }
  
  // Calculate depth for shading - use total depth if hues exhausted
  const parts = lineageName.split('.');
  const totalDepth = parts.length - 1; // 0 for root, 1 for first level, etc.
  
  // If hues are exhausted, increase shading variation by depth
  const depthFactor = huesExhausted ? totalDepth : Math.max(0, totalDepth - siblingGroups.length);
  
  // Adjust saturation and lightness based on depth
  // Deeper levels get more muted colors, but keep them distinguishable
  const baseSaturation = 75;
  const baseLightness = 50;
  
  const saturation = Math.max(30, baseSaturation - depthFactor * 10);
  const lightness = Math.max(25, baseLightness - depthFactor * 5);
  
  const result = hslToRgb(assignedHue, saturation, lightness);
  __hierarchicalColorCache[lineageName] = result;
  return result
}; 