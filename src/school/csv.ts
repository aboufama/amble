/**
 * Feedback CSV (§2.14): the teacher's checks and notes, one row per student file, for their own records.
 * RFC 4180 quoting, and cells that a spreadsheet would run as a formula (=, +, -, @, tab, CR) get a leading
 * apostrophe: titles and notes come from student files, so they are untrusted.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | boolean | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows to CSV text (CRLF line ends, as spreadsheets expect; a BOM so Excel reads UTF-8). */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>): string {
  return `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
