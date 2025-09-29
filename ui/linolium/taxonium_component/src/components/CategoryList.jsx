import React, { useState, useEffect } from "react";
import { Button } from "./Basic";
import { FaCheck, FaChevronRight, FaChevronDown, FaList, FaStream } from "react-icons/fa";
import { 
  organizeLineageHierarchy, 
  generatePangoLineageColor,
  isPangoLineage
} from "../utils/lineageUtils";

const CategoryList = ({ 
  keyStuff, 
  colorHook, 
  colorByField, 
  onCategorySelect, 
  selectedCategory: externalSelectedCategory,
  isPangoLineageField
}) => {
  const [sortedItems, setSortedItems] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [viewMode, setViewMode] = useState("flat"); // "flat" or "hierarchical"
  const [hierarchyData, setHierarchyData] = useState([]);
  const [expandedItems, setExpandedItems] = useState({});
  const [useHierarchicalColors, setUseHierarchicalColors] = useState(false);
  
  // Sort items by count (descending)
  useEffect(() => {
    if (keyStuff && keyStuff.length > 0) {
      const sorted = [...keyStuff].sort((a, b) => b.count - a.count);
      setSortedItems(sorted);
      
      // Build hierarchy data
      const hierarchy = organizeLineageHierarchy(keyStuff);
      setHierarchyData(hierarchy);
      
      // Auto-enable hierarchical colors if this is a Pango field
      setUseHierarchicalColors(isPangoLineageField || sorted.some(item => isPangoLineage(item.value)));
    } else {
      setSortedItems([]);
      setHierarchyData([]);
    }
  }, [keyStuff, isPangoLineageField]);

  // Sync with external selectedCategory when it changes
  useEffect(() => {
    setSelectedCategory(externalSelectedCategory);
  }, [externalSelectedCategory]);
  
  const handleCategoryClick = (category) => {
    const newSelectedValue = category.value === selectedCategory ? null : category.value;
    setSelectedCategory(newSelectedValue);
    onCategorySelect(newSelectedValue);
  };

  // Add a reset button if a category is selected
  const handleReset = () => {
    setSelectedCategory(null);
    onCategorySelect(null);
  };
  
  const toggleExpand = (lineageName) => {
    setExpandedItems(prev => ({
      ...prev,
      [lineageName]: !prev[lineageName]
    }));
  };
  
  // Get color for lineage, using hierarchical colors if enabled
  const getLineageColor = (lineageName) => {
    if (useHierarchicalColors && isPangoLineage(lineageName)) {
      return generatePangoLineageColor(lineageName);
    }
    
    // Use the original color otherwise
    const item = keyStuff.find(item => item.value === lineageName);
    return item ? item.color : [150, 150, 150];
  };
  
  // Render a hierarchical item and its children
  const renderHierarchicalItem = (node, level = 0) => {
    const isExpanded = expandedItems[node.name] || false;
    const hasChildren = node.children && node.children.length > 0;
    const nodeColor = useHierarchicalColors 
      ? getLineageColor(node.name)
      : node.color;
    
    return (
      <React.Fragment key={node.name}>
        <li 
          className={`text-sm cursor-pointer py-1 px-2 flex justify-between rounded ${
            selectedCategory === node.name ? "bg-blue-100 font-medium" : "hover:bg-gray-100"
          }`}
          style={{ paddingLeft: `${(level * 12) + 8}px` }}
        >
          <div 
            className="flex items-center flex-grow"
            style={{ 
              maxWidth: "85%", 
              overflow: "hidden", 
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {hasChildren && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(node.name);
                }}
                className="mr-1 focus:outline-none"
              >
                {isExpanded ? 
                  <FaChevronDown className="text-gray-500 w-3 h-3" /> : 
                  <FaChevronRight className="text-gray-500 w-3 h-3" />
                }
              </button>
            )}
            {!hasChildren && <span className="w-3 mr-1"></span>}
            
            <span 
              className={`inline-block w-3 h-3 mr-2 rounded-full ${
                selectedCategory === node.name ? "ring-2 ring-blue-400" : ""
              }`}
              style={{ backgroundColor: `rgb(${nodeColor.join(',')})` }}
            />
            
            <span 
              className="mr-2"
              onClick={() => handleCategoryClick({value: node.name})}
            >
              {node.name}
              {selectedCategory === node.name && (
                <FaCheck className="ml-1 text-blue-600 inline-block" size={10} />
              )}
            </span>
          </div>
          <span className="text-gray-500">{node.count}</span>
        </li>
        
        {isExpanded && hasChildren && (
          <ul className="ml-2">
            {node.children.map(child => renderHierarchicalItem(child, level + 1))}
          </ul>
        )}
      </React.Fragment>
    );
  };

  if (!keyStuff || keyStuff.length === 0) {
    return <div className="text-sm text-gray-500 italic">No categories available</div>;
  }
  
  // Check if we have Pango lineages to determine if hierarchical view makes sense
  const hasPangoLineages = isPangoLineageField || keyStuff.some(item => isPangoLineage(item.value));

  return (
    <div className="mt-2 max-h-60 overflow-y-auto">
      <div className="flex justify-between items-center text-xs text-gray-500 mb-2">
        <div>
          {sortedItems.length} unique {colorByField.replace('meta_', '')} categories
        </div>
        <div className="flex space-x-2">
          {selectedCategory && (
            <Button 
              className="py-0.5 px-2 text-xs bg-gray-100 hover:bg-gray-200"
              onClick={handleReset}
            >
              Reset
            </Button>
          )}
          
          {hasPangoLineages && (
            <div className="flex border rounded overflow-hidden">
              <button 
                className={`p-1 ${viewMode === 'flat' ? 'bg-blue-50' : 'bg-gray-50 hover:bg-gray-100'}`}
                onClick={() => setViewMode('flat')}
                title="Flat view"
              >
                <FaList size={12} />
              </button>
              <button 
                className={`p-1 ${viewMode === 'hierarchical' ? 'bg-blue-50' : 'bg-gray-50 hover:bg-gray-100'}`}
                onClick={() => setViewMode('hierarchical')}
                title="Hierarchical view"
              >
                <FaStream size={12} />
              </button>
            </div>
          )}
          
          {hasPangoLineages && (
            <button 
              className={`p-1 px-2 text-xs rounded border ${useHierarchicalColors ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 hover:bg-gray-100'}`}
              onClick={() => setUseHierarchicalColors(!useHierarchicalColors)}
              title={useHierarchicalColors ? "Using Pango-based colors" : "Use Pango-based colors"}
            >
              Pango Colors
            </button>
          )}
        </div>
      </div>
      
      {selectedCategory && (
        <div className="mb-2 py-1 px-2 bg-blue-50 border border-blue-100 rounded text-xs text-blue-800">
          Only showing nodes matching: <strong>{selectedCategory}</strong>
        </div>
      )}
      
      {viewMode === 'flat' ? (
        <ul className="space-y-1">
          {sortedItems.map((category) => {
            const itemColor = useHierarchicalColors && isPangoLineage(category.value)
              ? getLineageColor(category.value)
              : category.color;
              
            return (
              <li 
                key={category.value} 
                className={`text-sm cursor-pointer py-1 px-2 flex justify-between rounded ${
                  selectedCategory === category.value ? "bg-blue-100 font-medium" : "hover:bg-gray-100"
                }`}
                onClick={() => handleCategoryClick(category)}
              >
                <div 
                  className="flex items-center"
                  style={{ 
                    maxWidth: "85%", 
                    overflow: "hidden", 
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}
                >
                  <span 
                    className={`inline-block w-3 h-3 mr-2 rounded-full ${
                      selectedCategory === category.value ? "ring-2 ring-blue-400" : ""
                    }`}
                    style={{ backgroundColor: `rgb(${itemColor.join(',')})` }}
                  />
                  <span>{category.value || 'N/A'}</span>
                  {selectedCategory === category.value && (
                    <FaCheck className="ml-1 text-blue-600" size={10} />
                  )}
                </div>
                <span className="text-gray-500">{category.count}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="space-y-0">
          {hierarchyData.map(node => renderHierarchicalItem(node))}
        </ul>
      )}
    </div>
  );
};

export default CategoryList; 