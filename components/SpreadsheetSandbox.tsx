// components/SpreadsheetSandbox.tsx
import React, { useState, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table';
import * as XLSX from 'xlsx';
import ChartRenderer from './charts/ChartRenderer';
import type { TableData } from '../services/responseParser';

type SandboxTab = 'table' | 'chart';

interface SpreadsheetSandboxProps {
  tableData: TableData;
  title?: string;
}

const columnHelper = createColumnHelper<Record<string, string>>();

const SpreadsheetSandbox: React.FC<SpreadsheetSandboxProps> = ({ tableData, title }) => {
  const [activeTab, setActiveTab] = useState<SandboxTab>('table');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  // Build TanStack Table columns from headers
  const columns = tableData.headers.map(header =>
    columnHelper.accessor(header, {
      header: header,
      cell: info => info.getValue(),
    })
  );

  // Build row objects
  const rowData: Record<string, string>[] = tableData.rows.map(row => {
    const obj: Record<string, string> = {};
    tableData.headers.forEach((h, i) => {
      obj[h] = row[i] ?? '';
    });
    return obj;
  });

  const table = useReactTable({
    data: rowData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // Export to Excel
  const handleExport = useCallback(() => {
    const ws = XLSX.utils.aoa_to_sheet([
      tableData.headers,
      ...tableData.rows,
    ]);

    // Style column widths
    ws['!cols'] = tableData.headers.map(() => ({ wch: 18 }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title ?? 'Analyse CFO');
    XLSX.writeFile(wb, `${(title ?? 'analyse-cfo').replace(/\s+/g, '-').toLowerCase()}.xlsx`);

    setExportSuccess(true);
    setTimeout(() => setExportSuccess(false), 2000);
  }, [tableData, title]);

  const containerStyle: React.CSSProperties = isFullscreen
    ? {
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        margin: 0,
        borderRadius: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(10, 6, 30, 0.98)',
        backdropFilter: 'blur(20px)',
        padding: '0',
      }
    : {
        background: 'rgba(15, 10, 40, 0.6)',
        border: '1px solid rgba(124, 106, 255, 0.2)',
        borderRadius: 12,
        overflow: 'hidden',
        marginTop: 12,
        backdropFilter: 'blur(10px)',
      };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid rgba(124, 106, 255, 0.15)',
        background: 'rgba(124, 106, 255, 0.06)',
        flexShrink: 0,
      }}>
        {/* Title + Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#a78bfa', fontWeight: 600 }}>
            📊 {title ?? 'Analyse Financière'}
          </span>
          <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
            {(['table', 'chart'] as SandboxTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: activeTab === tab
                    ? '1px solid rgba(124,106,255,0.5)'
                    : '1px solid rgba(255,255,255,0.06)',
                  background: activeTab === tab
                    ? 'rgba(124,106,255,0.18)'
                    : 'transparent',
                  color: activeTab === tab ? '#c4b5fd' : '#64748b',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: activeTab === tab ? 600 : 400,
                  transition: 'all 0.2s',
                }}
              >
                {tab === 'table' ? '🗂️ Tableau' : '📈 Graphique'}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleExport}
            title="Exporter en Excel"
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              border: '1px solid rgba(52, 211, 153, 0.3)',
              background: exportSuccess
                ? 'rgba(52,211,153,0.2)'
                : 'rgba(52, 211, 153, 0.08)',
              color: exportSuccess ? '#34d399' : '#94a3b8',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            {exportSuccess ? '✅ Exporté !' : '💾 Export .xlsx'}
          </button>
          <button
            onClick={() => setIsFullscreen(f => !f)}
            title={isFullscreen ? 'Réduire' : 'Plein écran'}
            style={{
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.04)',
              color: '#64748b',
              cursor: 'pointer',
              fontSize: 13,
              transition: 'all 0.2s',
            }}
          >
            {isFullscreen ? '⊡' : '⛶'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{
        padding: '14px 16px',
        overflowY: 'auto',
        flex: 1,
        maxHeight: isFullscreen ? 'calc(100vh - 60px)' : '420px',
      }}>
        {activeTab === 'table' ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
            }}>
              <thead>
                {table.getHeaderGroups().map(headerGroup => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map(header => (
                      <th
                        key={header.id}
                        onClick={header.column.getToggleSortingHandler()}
                        style={{
                          padding: '8px 14px',
                          textAlign: 'left',
                          color: '#a78bfa',
                          fontWeight: 600,
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          background: 'rgba(124, 106, 255, 0.08)',
                          borderBottom: '1px solid rgba(124, 106, 255, 0.2)',
                          cursor: 'pointer',
                          userSelect: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' && ' ↑'}
                        {header.column.getIsSorted() === 'desc' && ' ↓'}
                        {!header.column.getIsSorted() && ' ⇅'}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row, rowIndex) => (
                  <tr
                    key={row.id}
                    style={{
                      background: rowIndex % 2 === 0
                        ? 'transparent'
                        : 'rgba(124, 106, 255, 0.03)',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.background = 'rgba(124, 106, 255, 0.08)';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.background = rowIndex % 2 === 0 ? 'transparent' : 'rgba(124, 106, 255, 0.03)';
                    }}
                  >
                    {row.getVisibleCells().map((cell, cellIndex) => (
                      <td
                        key={cell.id}
                        style={{
                          padding: '8px 14px',
                          color: cellIndex === 0 ? '#e2e8f0' : '#94a3b8',
                          fontWeight: cellIndex === 0 ? 500 : 400,
                          borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                          whiteSpace: 'nowrap',
                          fontFamily: cellIndex > 0 ? 'monospace' : 'inherit',
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 8, fontSize: 11, color: '#475569', textAlign: 'right' }}>
              {tableData.rows.length} lignes · {tableData.headers.length} colonnes · clic sur les en-têtes pour trier
            </div>
          </div>
        ) : (
          <ChartRenderer tableData={tableData} />
        )}
      </div>
    </div>
  );
};

export default SpreadsheetSandbox;
