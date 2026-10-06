import assert from 'node:assert/strict';
import test from 'node:test';
import { exportCsv, exportHtml, exportJson, exportRecipe } from '../src/exports';
import type { Comparison } from '../src/types';

function fixture(): Comparison {
  return {
    before: { name: '=before.csv', headers: ['id', 'value', 'unmapped'], rowCount: 5, delimiter: ',', skippedBlankLines: 1, sha256: 'a'.repeat(64) },
    after: { name: 'after.csv', headers: ['key', 'value'], rowCount: 4, delimiter: ';', skippedBlankLines: 0, sha256: 'b'.repeat(64) },
    mappings: [{ before: 'id', after: 'key', role: 'key' }, { before: 'value', after: 'value', role: 'compare' }],
    options: { trimWhitespace: false, ignoreCase: false },
    rows: [
      { status: 'changed', key: ['001'], before: [{ line: 2, values: ['001', '=SUM(1,2)', 'private-original'] }], after: [{ line: 2, values: ['001', '<script>alert("x")</script>\nnext line'] }], changes: [{ beforeColumn: 'value', afterColumn: 'value', before: '=SUM(1,2)', after: '<script>alert("x")</script>\nnext line' }] },
      { status: 'conflict', key: ['duplicate'], reason: 'duplicate-key', before: [{ line: 3, values: ['duplicate', '+CMD', 'first'] }, { line: 4, values: ['duplicate', '\t=HYPERLINK("https://example.com")', 'second'] }], after: [{ line: 4, values: ['duplicate', '@SUM(1)'] }, { line: 5, values: ['duplicate', '-1'] }], changes: [] },
      { status: 'conflict', key: [''], reason: 'blank-key', before: [{ line: 6, values: ['', '  =1', 'blank-key-value'] }], after: [], changes: [] },
      { status: 'unchanged', key: ['last'], before: [{ line: 7, values: ['last', 'same', 'excluded-but-preserved'] }], after: [{ line: 6, values: ['last', 'same'] }], changes: [] },
    ],
    counts: { added: 0, removed: 0, changed: 1, unchanged: 1, conflict: 2 },
    excludedBefore: ['unmapped'], excludedAfter: [],
  };
}

test('JSON preserves exact complete evidence and distinguishes groups from source records', () => {
  const comparison = fixture();
  const evidence = JSON.parse(exportJson(comparison));
  assert.equal(evidence.format, 'row-witness-evidence');
  assert.equal(evidence.version, 1);
  assert.deepEqual(evidence.comparison, comparison);
  assert.deepEqual(evidence.totals, { groups: 4, beforeRecords: 5, afterRecords: 4, exportedCsvRecords: 7 });
  assert.equal(evidence.comparison.rows[0].before[0].values[0], '001');
  assert.equal(evidence.comparison.rows[0].before[0].values[1], '=SUM(1,2)');
});

test('changes CSV keeps every conflicting source row, original line references and report settings', () => {
  const csv = exportCsv(fixture());
  assert.ok(csv.startsWith('\uFEFF"record_type"'));
  assert.equal((csv.match(/"source_record"/g) ?? []).length, 7);
  assert.match(csv, /"before","'=before.csv","4"/);
  assert.match(csv, /"after","after.csv","5"/);
  assert.match(csv, /"blank-key"/);
  assert.match(csv, /"first"/);
  assert.match(csv, /"second"/);
  assert.match(csv, /"private-original"/);
  assert.ok(!csv.includes('excluded-but-preserved'));
  assert.match(csv, /excludedBefore/);
  assert.match(csv, /trimWhitespace/);
  assert.match(csv, new RegExp('a'.repeat(64)));
});

test('spreadsheet CSV prefixes risky values while escaping delimiters, quotes and linebreaks', () => {
  const csv = exportCsv(fixture());
  for (const hardened of ["'=SUM(1,2)", "'+CMD", "'@SUM(1)", "'-1", "'  =1"]) assert.ok(csv.includes(`"${hardened}"`), hardened);
  assert.ok(csv.includes('"\'\t=HYPERLINK(""https://example.com"")"'));
  assert.ok(csv.includes('"<script>alert(""x"")</script>\nnext line"'));
  const comparison = fixture();
  comparison.before.headers[2] = 'x,"\n=malicious';
  comparison.rows[0]!.before[0]!.values[2] = '\n=1';
  assert.ok(exportCsv(comparison).includes('"before.x,""\n=malicious"'));
  assert.ok(exportCsv(comparison).includes('"\'\n=1"'));
});

test('HTML is scriptless, input-escaped and retains every source row and complete metadata', () => {
  const comparison = fixture();
  comparison.before.name = '"><img src=x onerror=alert(1)>';
  comparison.excludedBefore = ['<img src=x>'];
  comparison.rows[1]!.key = ['</code><script>alert(1)</script>'];
  const html = exportHtml(comparison);
  assert.doesNotMatch(html, /<script|<img|<iframe|<object|<a\s|<[^>]+\sonerror=/i);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /excluded-but-preserved/);
  assert.match(html, /private-original/);
  assert.match(html, /<th scope="row">7<\/th>/);
  assert.match(html, /4 comparison groups account for 5 before records and 4 after records/);
  assert.match(html, /No match was chosen/);
  assert.match(html, /At least one selected key field is blank/);
  assert.match(html, /Trim leading\/trailing whitespace: <strong>No/);
  assert.match(html, new RegExp('b'.repeat(64)));
});

test('reports do not apply the UI page size or omit the final group', () => {
  const comparison = fixture();
  comparison.rows = Array.from({ length: 251 }, (_, index) => ({ status: 'added' as const, key: [String(index)], before: [], after: [{ line: index + 2, values: [String(index), `record-${index}`] }], changes: [] }));
  comparison.before.rowCount = 0;
  comparison.after.rowCount = 251;
  comparison.counts = { added: 251, removed: 0, changed: 0, unchanged: 0, conflict: 0 };
  assert.equal((exportCsv(comparison).match(/"source_record"/g) ?? []).length, 251);
  assert.match(exportHtml(comparison), /Group 251/);
  assert.match(exportHtml(comparison), /record-250/);
  assert.equal(JSON.parse(exportJson(comparison)).comparison.rows.length, 251);
});

test('recipe output is config-only even when passed richer runtime objects', () => {
  const comparison = fixture();
  Object.assign(comparison.options, { filename: 'secret.csv', rows: [['personal-data']] });
  Object.assign(comparison.mappings[0]!, { source: comparison.before });
  const recipe = JSON.parse(exportRecipe(comparison.mappings, comparison.options));
  assert.deepEqual(recipe, {
    format: 'row-witness-recipe', version: 1,
    mappings: [{ before: 'id', after: 'key', role: 'key' }, { before: 'value', after: 'value', role: 'compare' }],
    options: { trimWhitespace: false, ignoreCase: false },
  });
  assert.doesNotMatch(JSON.stringify(recipe), /secret\.csv|personal-data|private-original/);
});

test('HTML preserves carriage returns as character references and does not repeat headers per group', () => {
  const comparison = fixture();
  comparison.before.headers[2] = 'excluded_header_once';
  comparison.excludedBefore = ['excluded_header_once'];
  comparison.rows[0]!.before[0]!.values[2] = 'one\r\ntwo\rthree';
  const html = exportHtml(comparison);
  assert.match(html, /one&#13;\ntwo&#13;three/);
  assert.doesNotMatch(html, /\r/);
  assert.equal((html.match(/excluded_header_once/g) ?? []).length, 2);
});

test('HTML budget rejects a complete oversized report rather than silently truncating', () => {
  const comparison = fixture();
  const complete = exportHtml(comparison);
  assert.equal(exportHtml(comparison, complete.length), complete);
  assert.throws(() => exportHtml(comparison, complete.length - 1), /too large.*Use JSON.*No report was truncated/);
  assert.throws(() => exportHtml(comparison, 5000), /too large/);
  assert.throws(() => exportHtml(comparison, Number.POSITIVE_INFINITY), /budget/);
  assert.throws(() => exportHtml(comparison, 64_000_001), /budget/);
});
