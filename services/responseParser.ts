// services/responseParser.ts
// Detects and extracts structured tabular data from AI agent responses

export interface TableData {
  headers: string[];
  rows: string[][];
}

export interface ParsedBlock {
  type: 'text' | 'table';
  content: string;
  tableData?: TableData;
  title?: string;
}

/**
 * Parse a Markdown table string into headers + rows
 */
function parseMarkdownTable(tableStr: string): TableData | null {
  const lines = tableStr.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;

  const parseRow = (line: string): string[] =>
    line
      .split('|')
      .map(cell => cell.trim())
      .filter((_, i, arr) => i > 0 && i < arr.length - 1);

  const headers = parseRow(lines[0]);
  // lines[1] is the separator (---|---), skip it
  const rows = lines.slice(2).map(parseRow);

  if (headers.length === 0) return null;
  return { headers, rows };
}

/**
 * Parse a JSON block that contains table data
 * Expected format: { "table": { "headers": [...], "rows": [[...]] }, "title": "..." }
 */
function parseJsonTable(jsonStr: string): { tableData: TableData; title?: string } | null {
  try {
    const parsed = JSON.parse(jsonStr);

    // Format: { table: { headers, rows } }
    if (parsed.table?.headers && parsed.table?.rows) {
      return {
        tableData: {
          headers: parsed.table.headers.map(String),
          rows: parsed.table.rows.map((row: unknown[]) => row.map(String)),
        },
        title: parsed.title,
      };
    }

    // Format: array of objects [{ col1: val, col2: val }]
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      const headers = Object.keys(parsed[0]);
      const rows = parsed.map(obj => headers.map(h => String(obj[h] ?? '')));
      return { tableData: { headers, rows } };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Main parser: splits an AI response into text blocks and table blocks
 */
export function parseAgentResponse(text: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];

  // 1. Extract ```json ... ``` blocks first
  const jsonBlockRegex = /```json\s*([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Build segments: alternate between text and code blocks
  type Segment = { type: 'text' | 'json' | 'markdown_table'; content: string; start: number; end: number };
  const segments: Segment[] = [];

  // Find JSON blocks
  jsonBlockRegex.lastIndex = 0;
  while ((match = jsonBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index), start: lastIndex, end: match.index });
    }
    segments.push({ type: 'json', content: match[1].trim(), start: match.index, end: match.index + match[0].length });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex), start: lastIndex, end: text.length });
  }

  // 2. Within text segments, detect Markdown tables
  const mdTableRegex = /(\|.+\|\s*\n\|[-| :]+\|\s*\n(?:\|.+\|\s*\n?)+)/g;

  for (const seg of segments) {
    if (seg.type === 'json') {
      const result = parseJsonTable(seg.content);
      if (result) {
        blocks.push({ type: 'table', content: seg.content, tableData: result.tableData, title: result.title });
      } else {
        blocks.push({ type: 'text', content: '```json\n' + seg.content + '\n```' });
      }
    } else {
      // text segment — look for markdown tables inside
      let textLastIndex = 0;
      mdTableRegex.lastIndex = 0;
      let mdMatch: RegExpExecArray | null;

      while ((mdMatch = mdTableRegex.exec(seg.content)) !== null) {
        if (mdMatch.index > textLastIndex) {
          const txt = seg.content.slice(textLastIndex, mdMatch.index).trim();
          if (txt) blocks.push({ type: 'text', content: txt });
        }
        const tableData = parseMarkdownTable(mdMatch[0]);
        if (tableData) {
          blocks.push({ type: 'table', content: mdMatch[0], tableData });
        } else {
          blocks.push({ type: 'text', content: mdMatch[0] });
        }
        textLastIndex = mdMatch.index + mdMatch[0].length;
      }

      const remaining = seg.content.slice(textLastIndex).trim();
      if (remaining) blocks.push({ type: 'text', content: remaining });
    }
  }

  return blocks.filter(b => b.content.trim().length > 0);
}

/**
 * Quick check: does a response contain any structured data?
 */
export function hasStructuredData(text: string): boolean {
  const hasMdTable = /\|.+\|\s*\n\|[-| :]+\|/.test(text);
  const hasJsonTable = /```json[\s\S]*?"table"[\s\S]*?```/.test(text) ||
    /```json[\s\S]*?\[[\s\S]*?\{[\s\S]*?\}[\s\S]*?\][\s\S]*?```/.test(text);
  return hasMdTable || hasJsonTable;
}
