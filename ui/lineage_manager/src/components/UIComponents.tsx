import React, { ReactNode, useState } from 'react';

export const CollapsibleSection = ({ 
  title, 
  children, 
  defaultOpen = false 
}: { 
  title: string; 
  children: ReactNode; 
  defaultOpen?: boolean 
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div style={{ marginBottom: '8px', border: '1px solid #dee2e6', borderRadius: '4px', overflow: 'hidden' }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '8px 12px',
          backgroundColor: '#f8f9fa',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: isOpen ? '1px solid #dee2e6' : 'none',
          fontSize: '12px',
          fontWeight: 'bold'
        }}
      >
        <span>{title}</span>
        <span style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
      </div>
      {isOpen && (
        <div style={{ padding: '12px', fontSize: '11px', lineHeight: '1.4' }}>
          {children}
        </div>
      )}
    </div>
  );
};

export const DataTable = ({ 
  data, 
  columns 
}: { 
  data: any[]; 
  columns: Array<{ key: string; label: string; width?: string }> 
}) => {
  if (data.length === 0) return <div style={{ color: '#6c757d', fontStyle: 'italic' }}>No data available</div>;
  
  return (
    <div style={{ overflowX: 'auto', border: '1px solid #dee2e6', borderRadius: '3px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
        <thead>
          <tr style={{ backgroundColor: '#e9ecef' }}>
            {columns.map((col) => (
              <th key={col.key} style={{ 
                padding: '6px 8px', 
                textAlign: 'left', 
                fontWeight: 'bold',
                width: col.width || 'auto',
                borderBottom: '1px solid #dee2e6'
              }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 50).map((row, i) => (
            <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#f8f9fa' : 'white' }}>
              {columns.map((col) => (
                <td key={col.key} style={{ 
                  padding: '4px 8px', 
                  borderBottom: '1px solid #f1f3f4',
                  wordBreak: 'break-word'
                }}>
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > 50 && (
        <div style={{ padding: '4px 8px', backgroundColor: '#f8f9fa', fontSize: '9px', color: '#6c757d', textAlign: 'center' }}>
          Showing first 50 of {data.length} rows
        </div>
      )}
    </div>
  );
};

export const StatCard = ({ 
  title, 
  value, 
  subtitle, 
  color = '#007bff' 
}: { 
  title: string; 
  value: string | number; 
  subtitle?: string; 
  color?: string 
}) => (
  <div style={{
    backgroundColor: 'white',
    border: `2px solid ${color}`,
    borderRadius: '6px',
    padding: '8px',
    textAlign: 'center',
    minWidth: '80px'
  }}>
    <div style={{ fontSize: '16px', fontWeight: 'bold', color }}>{value}</div>
    <div style={{ fontSize: '9px', color: '#6c757d', marginTop: '2px' }}>{title}</div>
    {subtitle && <div style={{ fontSize: '8px', color: '#6c757d' }}>{subtitle}</div>}
  </div>
);
