import React, { useState, useEffect } from 'react';
import * as pako from 'pako';
import Taxonium from 'taxonium-component';
import { RobustLineageTree } from './RobustLineageTree';
import { LineageParsimonyPanel } from './components/LineageParsimonyPanel';

interface LineageManagerProps {
  dataUrl?: string;
  onDataLoaded?: (nodeCount: number) => void;
}

export const LineageManager: React.FC<LineageManagerProps> = ({ 
  dataUrl = "https://cov2tree.nyc3.cdn.digitaloceanspaces.com/tfci-taxonium.jsonl.gz",
  onDataLoaded 
}) => {
  const [tree] = useState(() => new RobustLineageTree());
  const [count, setCount] = useState(0);
  const [selectedLineageType, setSelectedLineageType] = useState<string>('pango_lineage');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const decompressGzip = async (response: Response): Promise<string> => {
      try {
        console.log('Decompressing gzipped data...');
        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Check if it's actually gzipped (starts with magic bytes 0x1f, 0x8b)
        if (uint8Array[0] === 0x1f && uint8Array[1] === 0x8b) {
          console.log('Detected gzip format, using pako to decompress...');
          
          // Use pako to inflate the gzipped data
          const decompressed = pako.inflate(uint8Array, { to: 'string' });
          console.log(`Decompression successful: ${uint8Array.length} bytes -> ${decompressed.length} chars`);
          return decompressed;
        } else {
          console.log('Data is not gzipped, treating as plain text');
          return new TextDecoder().decode(uint8Array);
        }
      } catch (err) {
        console.error('Pako decompression failed:', err);
        
        // Fallback to browser DecompressionStream if available
        if ('DecompressionStream' in window) {
          try {
            console.log('Trying browser DecompressionStream as fallback...');
            const stream = response.body;
            if (stream) {
              const decompressionStream = new (window as any).DecompressionStream('gzip');
              const decompressedStream = stream.pipeThrough(decompressionStream);
              const decompressedResponse = new Response(decompressedStream);
              return await decompressedResponse.text();
            }
          } catch (streamErr) {
            console.warn('DecompressionStream also failed:', streamErr);
          }
        }
        
        throw new Error(`Failed to decompress gzipped data: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    };

    const processJSONL = async () => {
      try {
        setLoading(true);
        console.log('Fetching JSONL data...');
        
        console.log('Fetching from URL:', dataUrl);
        
        const response = await fetch(dataUrl);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch JSONL file (${response.status})`);
        }
        
        console.log('Response received, checking if decompression is needed...');
        
        let text: string;
        if (dataUrl.endsWith('.gz')) {
          console.log('File has .gz extension, attempting decompression...');
          text = await decompressGzip(response);
          console.log('Decompression completed successfully');
        } else {
          text = await response.text();
        }
        
        if (!text || text.length === 0) {
          throw new Error('Empty response after decompression');
        }
        
        // Validate the decompressed content
        const firstLine = text.split('\n')[0];
        console.log('First line sample (first 200 chars):', firstLine.substring(0, 200));
        
        // Check if decompression was successful (should start with JSON)
        if (firstLine.trim().startsWith('{') || firstLine.trim().startsWith('[')) {
          console.log('✅ Content appears to be valid JSON');
        } else {
          console.warn('⚠️ Content may not be valid JSON, first line:', firstLine.substring(0, 100));
        }
        
        // Additional check for binary content
        if (firstLine.includes('\u0000') || /[^\x20-\x7E\s\n\r\t]/.test(firstLine.substring(0, 200))) {
          console.error('❌ Content still appears to contain binary data');
          throw new Error('Decompression may have failed - data still appears binary');
        }
        
        console.log('Processing JSONL lines...');
        const lines = text.split('\n').filter(line => line.trim());
        console.log(`Found ${lines.length} lines to process`);
        
        let processedCount = 0;
        let validNodes = 0;
        
        for (const line of lines) {
          try {
            const nodeData = JSON.parse(line);
            
            // Extract node information directly from JSONL structure
            if (nodeData.node_id !== undefined) {
              const nodeId = nodeData.node_id;
              const parentId = nodeData.parent_id || null;
              
              tree.addNode(nodeId, parentId, nodeData);
              validNodes++;
              
              if (validNodes % 1000 === 0) {
                console.log(`Processed ${validNodes} valid nodes from JSONL...`);
                setCount(validNodes);
              }
            }
            processedCount++;
            
          } catch (lineError) {
            console.warn('Failed to parse line:', line.substring(0, 100), 'Error:', lineError);
            // Stop processing if we get too many parse errors early on
            if (processedCount < 20 && (processedCount - validNodes) > 10) {
              throw new Error('Multiple JSON parse errors detected. Decompression may have failed.');
            }
          }
        }
        
        setCount(validNodes);
        console.log(`\n${'='.repeat(60)}`);
        console.log(`JSONL PROCESSING COMPLETE:`);
        console.log(`  Total lines processed: ${processedCount}`);
        console.log(`  Valid nodes found: ${validNodes}`);
        console.log(`  Parse success rate: ${processedCount > 0 ? ((validNodes/processedCount)*100).toFixed(1) : 0}%`);
        console.log('='.repeat(60));
        
        if (validNodes === 0) {
          throw new Error('No valid nodes found in JSONL file. Please check the file format.');
        }
        
        tree.analyze();
        setLoading(false);
        
        if (onDataLoaded) {
          onDataLoaded(validNodes);
        }
        
      } catch (err) {
        console.error('Error processing JSONL:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      }
    };

    processJSONL();
  }, [dataUrl, tree, onDataLoaded]);

  // Fallback callback for Taxonium (should rarely be used)
  const handleNodeDetailsLoaded = (nodeId: string | number | null, details: any) => {
    // This should rarely be called now since we're processing JSONL directly
    console.log('Fallback node details loaded:', nodeId);
  };

  console.log('Rendering with count:', count);

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <LineageParsimonyPanel tree={tree} selectedType={selectedLineageType} />
      <div style={{ flex: 1 }}>
        <div style={{ 
          padding: '8px', 
          borderBottom: '1px solid #dee2e6', 
          backgroundColor: '#fff',
          display: 'flex',
          gap: '8px',
          alignItems: 'center'
        }}>
          <label style={{ fontSize: '12px', color: '#495057' }}>Lineage Type:</label>
          <select 
            value={selectedLineageType}
            onChange={(e) => setSelectedLineageType(e.target.value)}
            style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ced4da' }}
          >
            <option value="pango_lineage">Pango Lineage</option>
            <option value="nextstrain_clade">Nextstrain Clade</option>
            <option value="who_name">WHO Name</option>
            <option value="lineage">Lineage</option>
          </select>
          <div style={{ 
            marginLeft: 'auto', 
            display: 'flex', 
            gap: '12px', 
            fontSize: '11px', 
            color: '#6c757d' 
          }}>
            {loading ? (
              <>
                <span>🔄 Loading complete JSONL dataset...</span>
                <span>📊 {count} nodes processed</span>
              </>
            ) : error ? (
              <span style={{ color: '#dc3545' }}>❌ Error: {error}</span>
            ) : (
              <>
                <span>✅ Complete dataset processed: {count} nodes</span>
                <span>📈 Full lineage analysis available</span>
              </>
            )}
          </div>
        </div>
        <div style={{ height: 'calc(100% - 41px)' }}>
          <Taxonium 
            sourceData={{
              status: "url_supplied",
              filename: dataUrl,
              filetype: "jsonl",
            }}
            onNodeDetailsLoaded={handleNodeDetailsLoaded} 
          />
        </div>
      </div>
    </div>
  );
};
