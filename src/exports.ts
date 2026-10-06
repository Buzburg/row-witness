import type { ColumnMapping, CompareOptions, Comparison, DiffRow, Recipe, TableMeta } from './types';

const LABELS = { added: 'Added', removed: 'Removed', changed: 'Changed', unchanged: 'Unchanged', conflict: 'Needs review' } as const;
export const HTML_REPORT_CHARACTER_LIMIT = 64_000_000;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"'\r]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '\r': '&#13;' })[character]!);
}

/** Reduce spreadsheet formula interpretation; the JSON and HTML exports retain exact strings. */
function csvCell(value: string): string {
  const hazardous = /^[\t\r\n]/u.test(value) || /^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(value);
  const hardened = hazardous ? `'${value}` : value;
  return `"${hardened.replace(/"/g, '""')}"`;
}

function totals(comparison: Comparison): { groups: number; beforeRecords: number; afterRecords: number; exportedCsvRecords: number } {
  return {
    groups: comparison.rows.length,
    beforeRecords: comparison.rows.reduce((sum, row) => sum + row.before.length, 0),
    afterRecords: comparison.rows.reduce((sum, row) => sum + row.after.length, 0),
    exportedCsvRecords: comparison.rows.reduce((sum, row) => sum + (row.status === 'unchanged' ? 0 : row.before.length + row.after.length), 0),
  };
}

/** Versioned, lossless evidence: includes unchanged groups and excluded original values. */
export function exportJson(comparison: Comparison): string {
  return JSON.stringify({ format: 'row-witness-evidence', version: 1, totals: totals(comparison), comparison }, null, 2) + '\n';
}

/** Explicit fields prevent accidental inclusion of filenames or records from richer objects. */
export function exportRecipe(mappings: ColumnMapping[], options: CompareOptions): string {
  const recipe: Recipe = {
    format: 'row-witness-recipe',
    version: 1,
    mappings: mappings.map(({ before, after, role }) => ({ before, after, role })),
    options: { trimWhitespace: options.trimWhitespace, ignoreCase: options.ignoreCase },
  };
  return JSON.stringify(recipe, null, 2) + '\n';
}

/** One metadata record, then one CSV record per original changed/exception source row. */
export function exportCsv(comparison: Comparison): string {
  const beforeWidth = comparison.before.headers.length;
  const afterWidth = comparison.after.headers.length;
  const columns = [
    'record_type', 'comparison_group', 'status', 'reason', 'matched_key_json', 'source',
    'source_filename', 'source_start_line', 'changed_cells_json', 'metadata_json',
    ...comparison.before.headers.map(header => `before.${header}`),
    ...comparison.after.headers.map(header => `after.${header}`),
  ];
  const metadata = {
    format: 'row-witness-changes', version: 1,
    description: 'One source row per record. Unchanged comparison groups are omitted. Values beginning with spreadsheet formula prefixes have an apostrophe added; use JSON or HTML for exact strings.',
    totals: totals(comparison), counts: comparison.counts,
    before: comparison.before, after: comparison.after,
    mappings: comparison.mappings, options: comparison.options,
    excludedBefore: comparison.excludedBefore, excludedAfter: comparison.excludedAfter,
  };
  const lines = [columns.map(csvCell).join(',')];
  lines.push(['metadata', '', '', '', '', '', '', '', '', JSON.stringify(metadata), ...Array<string>(beforeWidth + afterWidth).fill('')].map(csvCell).join(','));
  comparison.rows.forEach((group, index) => {
    if (group.status === 'unchanged') return;
    (['before', 'after'] as const).forEach(side => {
      group[side].forEach(row => {
        const beforeValues = side === 'before' ? comparison.before.headers.map((_, column) => row.values[column] ?? '') : Array<string>(beforeWidth).fill('');
        const afterValues = side === 'after' ? comparison.after.headers.map((_, column) => row.values[column] ?? '') : Array<string>(afterWidth).fill('');
        lines.push([
          'source_record', String(index + 1), group.status, group.reason ?? '', JSON.stringify(group.key), side,
          comparison[side].name, String(row.line), JSON.stringify(group.changes), '', ...beforeValues, ...afterValues,
        ].map(csvCell).join(','));
      });
    });
  });
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

function textList(values: string[]): string {
  return values.length ? values.map(value => `<code>${escapeHtml(value)}</code>`).join(', ') : 'None';
}

function sourceDetails(label: string, meta: TableMeta, excluded: string[]): string {
  const delimiter = meta.delimiter === '\t' ? 'tab' : meta.delimiter;
  return `<article><h3>${label}</h3><dl><dt>Filename</dt><dd>${escapeHtml(meta.name)}</dd><dt>Data records</dt><dd>${meta.rowCount}</dd><dt>Columns</dt><dd>${meta.headers.length}</dd><dt>Delimiter</dt><dd><code>${escapeHtml(delimiter)}</code></dd><dt>Skipped blank lines</dt><dd>${meta.skippedBlankLines}</dd><dt>SHA-256 of input bytes</dt><dd class="hash">${escapeHtml(meta.sha256)}</dd><dt>Excluded columns (not compared)</dt><dd>${textList(excluded)}</dd></dl></article>`;
}

function groupHtml(group: DiffRow, index: number): string {
  const reason = group.reason === 'blank-key' ? 'At least one selected key field is blank.' : group.reason === 'duplicate-key' ? 'The selected key is repeated. No match was chosen.' : '';
  return `<tr class="${group.status}"><th scope="row">Group ${index + 1}</th><td>${LABELS[group.status]}</td><td class="value">${escapeHtml(JSON.stringify(group.key))}</td><td>${group.before.length}</td><td>${group.after.length}</td><td>${reason}</td></tr>`;
}

/** Standalone scriptless report. A smaller optional budget is useful for embedding or testing. */
export function exportHtml(comparison: Comparison, maxCharacters = HTML_REPORT_CHARACTER_LIMIT): string {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > HTML_REPORT_CHARACTER_LIMIT) {
    throw new Error(`The HTML report budget must be between 1 and ${HTML_REPORT_CHARACTER_LIMIT} characters.`);
  }
  const chunks: string[] = [];
  let characters = 0;
  const append = (chunk: string): void => {
    characters += chunk.length;
    if (characters > maxCharacters) throw new Error('The complete HTML report is too large to export safely. Use JSON evidence or compare smaller files. No report was truncated.');
    chunks.push(chunk);
  };
  const summary = totals(comparison);
  const counts = Object.entries(comparison.counts).map(([status, count]) => `<li><strong>${count}</strong> ${LABELS[status as keyof typeof LABELS]} groups</li>`).join('');
  const mappings = comparison.mappings.map((mapping, index) => `<tr><th scope="row">${index + 1}</th><td>${mapping.role === 'key' ? 'Key' : 'Compare'}</td><td>${escapeHtml(mapping.before)}</td><td>${escapeHtml(mapping.after)}</td></tr>`).join('');
  append(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'; connect-src 'none'"><title>Row Witness comparison report</title><style>
:root{color-scheme:light;font-family:system-ui,sans-serif;color:#172b36;background:#f6f7f5}*{box-sizing:border-box}body{max-width:1200px;margin:auto;padding:28px}h1{font-size:2.4rem;margin-bottom:8px}h2{margin-top:36px}h3{margin-top:0}p,li,dd{line-height:1.6}code,pre,.hash{font-family:ui-monospace,monospace;overflow-wrap:anywhere}pre{white-space:pre-wrap;margin:0;font-size:.9rem;min-height:1em}.hash{word-break:break-all}ul.counts{display:flex;flex-wrap:wrap;gap:12px;list-style:none;padding:0}.counts li,article,.group{border:1px solid #cbd7d8;border-radius:10px;background:white;padding:16px}.sources{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:16px}dt{font-weight:700;margin-top:12px}dd{margin-left:0;white-space:pre-wrap}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.92rem}th,td{border:1px solid #ccd6d8;padding:10px;text-align:left;vertical-align:top}th{background:#edf2f3}td{max-width:450px;overflow-wrap:anywhere}.group{margin:20px 0;break-inside:avoid}.badge{display:inline-block;font-size:.85rem;border:1px solid currentColor;padding:3px 9px;border-radius:20px}.conflict{border-left:5px solid #8d5400}.changed{border-left:5px solid #206a9a}.added{border-left:5px solid #167049}.removed{border-left:5px solid #a33d3d}.note{background:#e9f1ee;padding:16px;border-radius:8px}@media print{body{max-width:none;padding:0;background:white}.table-wrap{overflow:visible}table{font-size:8pt}td{max-width:200px}h1{font-size:20pt}}@media(max-width:500px){body{padding:14px}h1{font-size:1.8rem}}
.value{white-space:pre-wrap;font-family:ui-monospace,monospace}
</style></head><body><header><p>ROW WITNESS · COMPLETE COMPARISON REPORT · VERSION 1</p><h1>What changed between these exports</h1><p>${summary.groups} comparison groups account for ${summary.beforeRecords} before records and ${summary.afterRecords} after records. Counts below are groups, not source records.</p></header>
<ul class="counts">${counts}</ul><p class="note">This report includes all comparison groups and all original source records, including unchanged groups, excluded fields and every duplicate or blank-key exception. “Unchanged” means the selected comparison fields match under the options below; it does not mean all original strings are identical. A file fingerprint identifies bytes; it does not authenticate their author or prove their correctness.</p>
<h2>Source files</h2><div class="sources">${sourceDetails('Before', comparison.before, comparison.excludedBefore)}${sourceDetails('After', comparison.after, comparison.excludedAfter)}</div>
<h2>Comparison settings</h2><p>Trim leading/trailing whitespace: <strong>${comparison.options.trimWhitespace ? 'Yes' : 'No'}</strong>. Ignore case: <strong>${comparison.options.ignoreCase ? 'Yes' : 'No'}</strong>. These options apply to keys and compared cells. Values below retain their original text.</p><div class="table-wrap"><table><thead><tr><th>Mapping</th><th>Role</th><th>Before column</th><th>After column</th></tr></thead><tbody>${mappings}</tbody></table></div><p>Source line references are the physical starting line in the original file, including the header. A quoted multiline record can span several physical lines.</p>
<h2>Complete comparison groups</h2><p>Key values are represented as a JSON array. Group numbers connect this table, changed cells and original source records below.</p><div class="table-wrap"><table><thead><tr><th>Group</th><th>Status</th><th>Key</th><th>Before records</th><th>After records</th><th>Reason</th></tr></thead><tbody>`);
  comparison.rows.forEach((group, index) => append(groupHtml(group, index)));
  append('</tbody></table></div><h2>Changed compared cells</h2><p>The mapping number refers to the comparison settings above.</p><div class="table-wrap"><table><thead><tr><th>Group</th><th>Mapping</th><th>Before value</th><th>After value</th></tr></thead><tbody>');
  comparison.rows.forEach((group, index) => {
    for (const change of group.changes) {
      const mapping = comparison.mappings.findIndex(pair => pair.before === change.beforeColumn && pair.after === change.afterColumn) + 1;
      append(`<tr><th scope="row">${index + 1}</th><td>${mapping}</td><td class="value">${escapeHtml(change.before)}</td><td class="value">${escapeHtml(change.after)}</td></tr>`);
    }
  });
  append('</tbody></table></div>');
  for (const side of ['before', 'after'] as const) {
    const meta = comparison[side];
    append(`<h2>${side === 'before' ? 'Before' : 'After'}: all original source records</h2><div class="table-wrap"><table><thead><tr><th scope="col">Group</th><th scope="col">Source start line</th>${meta.headers.map(header => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>`);
    comparison.rows.forEach((group, index) => {
      for (const row of group[side]) {
        append(`<tr><td>${index + 1}</td><th scope="row">${row.line}</th>${meta.headers.map((_, column) => `<td class="value">${escapeHtml(row.values[column] ?? '')}</td>`).join('')}</tr>`);
      }
    });
    append('</tbody></table></div>');
  }
  append('<footer><p>Generated locally by Row Witness. This report contains source data; share it only with intended recipients. It contains no scripts, external assets, requests or active links.</p></footer></body></html>\n');
  return chunks.join('');
}
