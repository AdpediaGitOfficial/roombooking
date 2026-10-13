// Minimal RFC 4180 CSV reader: quoted fields, doubled quotes, CR/LF line ends, BOM.

export type Parsed = { headers: string[]; rows: Array<{ line: number; values: string[] }> };

export function parseCsv(text: string): Parsed {
  const src = text.replace(/^﻿/, "");
  const records: Array<{ line: number; values: string[] }> = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { endField(); if (row.some((v) => v.trim() !== "")) records.push({ line: rowLine, values: row }); row = []; rowLine = line; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else { field += c; if (c === "\n") line++; }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") endField();
    else if (c === "\r") { /* handled with \n */ }
    else if (c === "\n") { line++; endRow(); rowLine = line; }
    else field += c;
  }
  if (field !== "" || row.length) endRow();
  if (records.length === 0) return { headers: [], rows: [] };
  const [head, ...rest] = records;
  return { headers: head.values.map((h) => h.trim()), rows: rest };
}

/** Rows as objects keyed by lower-cased header; unknown columns are kept so the preview can show them. */
export function toRecords(parsed: Parsed): Array<{ line: number; values: Record<string, string> }> {
  const keys = parsed.headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  return parsed.rows.map((r) => ({ line: r.line, values: Object.fromEntries(keys.map((k, i) => [k, (r.values[i] ?? "").trim()])) }));
}

export function csvField(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}
