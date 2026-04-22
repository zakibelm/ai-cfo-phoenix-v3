// components/charts/ChartRenderer.tsx
import React, { useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import type { TableData } from '../../services/responseParser';

type ChartType = 'bar' | 'line' | 'area' | 'pie';

interface ChartRendererProps {
  tableData: TableData;
}

const PHOENIX_COLORS = [
  '#7c6aff', // violet
  '#a78bfa', // violet clair
  '#38bdf8', // bleu
  '#34d399', // vert
  '#fb923c', // orange
  '#f472b6', // rose
  '#facc15', // jaune
  '#60a5fa', // bleu clair
];

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  bar: 'Barres',
  line: 'Courbes',
  area: 'Aires',
  pie: 'Camembert',
};

const CHART_TYPE_ICONS: Record<ChartType, string> = {
  bar: '📊',
  line: '📈',
  area: '📉',
  pie: '🥧',
};

/**
 * Try to parse a value like "125k", "$1,200", "48.5%" as a number
 */
function parseNumericValue(val: string): number | null {
  if (!val) return null;
  const cleaned = val
    .replace(/[$€£¥,\s%]/g, '')
    .replace(/k$/i, '000')
    .replace(/m$/i, '000000')
    .replace(/b$/i, '000000000');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Convert TableData to Recharts-compatible data array
 * Uses first column as X-axis label, remaining numeric columns as series
 */
function tableToChartData(tableData: TableData): {
  data: Record<string, string | number>[];
  numericKeys: string[];
} {
  const [labelKey, ...valueKeys] = tableData.headers;

  const numericKeys = valueKeys.filter(key => {
    const colIndex = tableData.headers.indexOf(key);
    return tableData.rows.some(row => parseNumericValue(row[colIndex]) !== null);
  });

  const data = tableData.rows.map(row => {
    const entry: Record<string, string | number> = {
      [labelKey]: row[0] ?? '',
    };
    numericKeys.forEach(key => {
      const idx = tableData.headers.indexOf(key);
      const parsed = parseNumericValue(row[idx] ?? '');
      entry[key] = parsed ?? 0;
    });
    return entry;
  });

  return { data, numericKeys };
}

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(15, 10, 40, 0.95)',
      border: '1px solid rgba(124, 106, 255, 0.3)',
      borderRadius: '8px',
      padding: '10px 14px',
      backdropFilter: 'blur(10px)',
    }}>
      <p style={{ color: '#a78bfa', fontWeight: 600, marginBottom: 6, fontSize: 12 }}>{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color, fontSize: 12, margin: '2px 0' }}>
          {p.name}: <strong>{p.value.toLocaleString()}</strong>
        </p>
      ))}
    </div>
  );
};

const ChartRenderer: React.FC<ChartRendererProps> = ({ tableData }) => {
  const [chartType, setChartType] = useState<ChartType>('bar');
  const { data, numericKeys } = tableToChartData(tableData);
  const labelKey = tableData.headers[0];

  if (numericKeys.length === 0) {
    return (
      <div style={{ padding: '16px', color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>
        Aucune donnée numérique détectée pour générer un graphique.
      </div>
    );
  }

  const renderChart = () => {
    const commonProps = {
      data,
      margin: { top: 10, right: 20, left: 0, bottom: 5 },
    };

    const axisProps = {
      xAxis: <XAxis dataKey={labelKey} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />,
      yAxis: <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={55} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />,
      grid: <CartesianGrid strokeDasharray="3 3" stroke="rgba(124,106,255,0.1)" />,
      tooltip: <Tooltip content={<CustomTooltip />} />,
      legend: <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />,
    };

    if (chartType === 'pie') {
      // Pie: use first numeric key, rows as slices
      const pieData = data.map(row => ({
        name: String(row[labelKey]),
        value: Number(row[numericKeys[0]] ?? 0),
      }));
      return (
        <PieChart>
          <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={110} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}>
            {pieData.map((_, index) => (
              <Cell key={index} fill={PHOENIX_COLORS[index % PHOENIX_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
        </PieChart>
      );
    }

    if (chartType === 'line') {
      return (
        <LineChart {...commonProps}>
          {axisProps.grid}{axisProps.xAxis}{axisProps.yAxis}
          {axisProps.tooltip}{axisProps.legend}
          {numericKeys.map((key, i) => (
            <Line key={key} type="monotone" dataKey={key} stroke={PHOENIX_COLORS[i % PHOENIX_COLORS.length]} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          ))}
        </LineChart>
      );
    }

    if (chartType === 'area') {
      return (
        <AreaChart {...commonProps}>
          <defs>
            {numericKeys.map((key, i) => (
              <linearGradient key={key} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={PHOENIX_COLORS[i % PHOENIX_COLORS.length]} stopOpacity={0.3} />
                <stop offset="95%" stopColor={PHOENIX_COLORS[i % PHOENIX_COLORS.length]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {axisProps.grid}{axisProps.xAxis}{axisProps.yAxis}
          {axisProps.tooltip}{axisProps.legend}
          {numericKeys.map((key, i) => (
            <Area key={key} type="monotone" dataKey={key} stroke={PHOENIX_COLORS[i % PHOENIX_COLORS.length]} fill={`url(#grad-${i})`} strokeWidth={2} />
          ))}
        </AreaChart>
      );
    }

    // Default: Bar
    return (
      <BarChart {...commonProps} barSize={numericKeys.length > 1 ? 16 : 32}>
        {axisProps.grid}{axisProps.xAxis}{axisProps.yAxis}
        {axisProps.tooltip}{axisProps.legend}
        {numericKeys.map((key, i) => (
          <Bar key={key} dataKey={key} fill={PHOENIX_COLORS[i % PHOENIX_COLORS.length]} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    );
  };

  return (
    <div>
      {/* Chart Type Selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(Object.keys(CHART_TYPE_LABELS) as ChartType[]).map(type => (
          <button
            key={type}
            onClick={() => setChartType(type)}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              border: chartType === type ? '1px solid rgba(124,106,255,0.6)' : '1px solid rgba(255,255,255,0.1)',
              background: chartType === type ? 'rgba(124,106,255,0.2)' : 'rgba(255,255,255,0.04)',
              color: chartType === type ? '#a78bfa' : '#64748b',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: chartType === type ? 600 : 400,
              transition: 'all 0.2s',
            }}
          >
            {CHART_TYPE_ICONS[type]} {CHART_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={280}>
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
};

export default ChartRenderer;
