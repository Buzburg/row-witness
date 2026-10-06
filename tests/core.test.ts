import test from 'node:test';
import assert from 'node:assert/strict';
import { compareTables, LIMITS, parseTable, suggestMappings, validateRecipe } from '../src/core';
import type { ColumnMapping, Comparison, Delimiter, Recipe, Table } from '../src/types';

const exact = { trimWhitespace: false, ignoreCase: false };
const mapping: ColumnMapping[] = [{ before: 'id', after: 'id', role: 'key' }, { before: 'value', after: 'value', role: 'compare' }];
const parse = (text: string, delimiter: Delimiter | 'auto' = ','): Table => parseTable(text, 'test.csv', delimiter);
const diff = (before: string, after: string): Comparison => compareTables(parse(before), parse(after), mapping, exact);
const recipe = (): Recipe => ({ format: 'row-witness-recipe', version: 1, mappings: mapping, options: exact });

function csv(rows: string[][], delimiter: Delimiter = ','): string {
  return rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(delimiter)).join('\r\n');
}

function assertPartition(result: Comparison, before: Table, after: Table): void {
  const left = result.rows.flatMap(row => row.before);
  const right = result.rows.flatMap(row => row.after);
  assert.equal(left.length, before.rows.length);
  assert.equal(right.length, after.rows.length);
  assert.equal(new Set(left).size, left.length);
  assert.equal(new Set(right).size, right.length);
  assert.deepEqual(new Set(left), new Set(before.rows));
  assert.deepEqual(new Set(right), new Set(after.rows));
  assert.equal(Object.values(result.counts).reduce((sum, count) => sum + count, 0), result.rows.length);
}

test('quoted delimiters, escaped quotes, BOM, identifiers and multiline values survive unchanged', () => {
  const table = parse('\ufeffid,value\r\n0012,"a,b"\r\n000000000000000000009,"said ""hi""\r\nand bye"\r\n');
  assert.deepEqual(table.headers, ['id', 'value']);
  assert.deepEqual(table.rows, [
    { line: 2, values: ['0012', 'a,b'] },
    { line: 3, values: ['000000000000000000009', 'said "hi"\r\nand bye'] },
  ]);
  assert.equal(table.sha256, '');
  assert.equal(table.rowCount, 2);
});

test('physical references account for blank lines and mixed line endings', () => {
  const table = parse('\n\r\nid,value\r1,"two\nlines"\r\n\n2,done\n');
  assert.deepEqual(table.rows.map(row => row.line), [4, 7]);
  assert.equal(table.skippedBlankLines, 3);
});

test('empty physical lines are skipped, quoted empty cells and delimiter-only rows are retained', () => {
  const table = parse('id,value\n\n,\n"",""\n');
  assert.equal(table.skippedBlankLines, 1);
  assert.deepEqual(table.rows.map(row => row.values), [['', ''], ['', '']]);
  assert.deepEqual(parse('id\n""\n').rows[0]!.values, ['']);
});

for (const delimiter of [',', ';', '\t', '|'] as const) {
  test(`auto detects ${JSON.stringify(delimiter)} and preserves quoted values`, () => {
    const table = parseTable(csv([['id', 'value'], ['1', `a${delimiter}b`]], delimiter), 'sample', 'auto');
    assert.equal(table.delimiter, delimiter);
    assert.deepEqual(table.rows[0]!.values, ['1', `a${delimiter}b`]);
  });
}

test('ambiguous delimiter requires explicit override', () => {
  const text = 'id,name;city\n1,Ada;London\n';
  assert.throws(() => parse(text, 'auto'), /ambiguous/);
  assert.deepEqual(parse(text, ',').headers, ['id', 'name;city']);
  assert.deepEqual(parse(text, ';').headers, ['id,name', 'city']);
});

test('full-record consistency can disambiguate the header', () => {
  const table = parse('id,name;city\n1,Ada\n2,Lin\n', 'auto');
  assert.equal(table.delimiter, ',');
});

test('single-column CSV and a header-only file are valid', () => {
  assert.deepEqual(parse('id\n001\n002', 'auto').rows.map(row => row.values), [['001'], ['002']]);
  assert.equal(parse('id,value').rowCount, 0);
});

test('field whitespace and Unicode are preserved', () => {
  assert.deepEqual(parse('id,value\n 01 , café 😀 \n').rows[0]!.values, [' 01 ', ' café 😀 ']);
});

for (const text of ['', '\ufeff', '\n\r\n']) {
  test(`rejects empty input ${JSON.stringify(text)}`, () => assert.throws(() => parse(text), /empty/));
}

test('malformed records explain field count, physical line and start line', () => {
  assert.throws(() => parse('id,value\n1,"two\nlines",extra\n'), /Line 3 \(record starts at line 2\): Expected 2 fields but found 3/);
  assert.throws(() => parse('id,value\n1\n'), /Expected 2 fields but found 1/);
});

for (const text of ['id,value\n1,a"b', 'id,value\n1,"abc', 'id,value\n1,"abc"x', 'id,value\n1,"abc" ']) {
  test(`rejects malformed quoting ${JSON.stringify(text)}`, () => assert.throws(() => parse(text), /quote|quoted/));
}

test('auto mode never turns duplicate or blank headers into a one-column file', () => {
  assert.throws(() => parse('id;id\n1;2', 'auto'), /Duplicate header/);
  assert.throws(() => parse('id;\n1;2', 'auto'), /nonblank header/);
  assert.throws(() => parse('id,id\n1,2', 'auto'), /Duplicate header/);
});

test('binary control characters and invalid Unicode are rejected', () => {
  assert.throws(() => parse('id,value\n1,\u0000'), /Binary/);
  assert.throws(() => parse('id,value\n1,\ud800'), /Unicode/);
  assert.throws(() => parse('id,value\n1,\udc00'), /Unicode/);
  assert.equal(parse('id,value\n1,�').rows[0]!.values[1], '�'); // Literal U+FFFD is valid Unicode.
});

test('byte limit measures UTF-8, including multibyte characters', () => {
  assert.throws(() => parse('id\n' + 'a'.repeat(LIMITS.maxBytes)), /10 MiB/);
  assert.throws(() => parse('id\n' + 'é'.repeat(LIMITS.maxBytes / 2)), /10 MiB/);
});

test('column and row limits reject the entire input', () => {
  const headers = Array.from({ length: LIMITS.maxColumns + 1 }, (_, index) => `h${index}`).join(';');
  assert.throws(() => parse(headers, 'auto'), /200 columns/);
  assert.throws(() => parse('id\n' + 'x\n'.repeat(LIMITS.maxRows + 1)), /100,000 data records/);
  assert.equal(parse('id\n' + 'x\n'.repeat(LIMITS.maxRows)).rowCount, LIMITS.maxRows);
});

test('cell limit includes the header and prevents wide, mostly empty input from exhausting memory', () => {
  const width = 200;
  const header = Array.from({ length: width }, (_, index) => `h${index}`).join(',');
  const emptyRow = ','.repeat(width - 1) + '\n';
  assert.throws(() => parse(header + '\n' + emptyRow.repeat(LIMITS.maxCells / width)), /2,000,000 cells/);
  assert.equal(parse(header + '\n' + emptyRow.repeat(LIMITS.maxCells / width - 1)).rows.length, 9_999);
});

test('header length is bounded without changing its exact text', () => {
  const header = ' ' + 'a'.repeat(LIMITS.maxHeaderLength - 2) + ' ';
  assert.equal(parse(csv([[header, 'id'], ['value', '1']]), 'auto').headers[0], header);
  assert.throws(() => parse(csv([['a'.repeat(LIMITS.maxHeaderLength + 1), 'id'], ['value', '1']]), 'auto'), /at most 512 characters/);
  assert.throws(() => validateRecipe({ ...recipe(), mappings: [{ before: 'a'.repeat(513), after: 'id', role: 'key' }] }), /at most 512 characters/);
});

test('reordered rows and columns compare unchanged using explicit mappings', () => {
  const before = parse('id,value,unused\n1,A,x\n2,B,y');
  const after = parse('newValue,newId,other\nB,2,q\nA,1,z');
  const result = compareTables(before, after, [
    { before: 'id', after: 'newId', role: 'key' }, { before: 'value', after: 'newValue', role: 'compare' },
  ], exact);
  assert.equal(result.counts.unchanged, 2);
  assert.deepEqual(result.excludedBefore, ['unused']);
  assert.deepEqual(result.excludedAfter, ['other']);
  assertPartition(result, before, after);
});

test('added, removed, changed and unchanged records have exact values and references', () => {
  const result = diff('id,value\n1,A\n2,B\n3,C', 'id,value\n1,A\n2,changed\n4,D');
  assert.deepEqual(result.counts, { added: 1, removed: 1, changed: 1, unchanged: 1, conflict: 0 });
  assert.deepEqual(result.rows[1]!.changes, [{ beforeColumn: 'value', afterColumn: 'value', before: 'B', after: 'changed' }]);
  assert.equal(result.rows[1]!.before[0]!.line, 3);
});

test('all duplicate records on both sides form one conflict without a selected winner', () => {
  const before = parse('id,value\n1,A\n1,B\n2,C\n3,D');
  const after = parse('id,value\n1,E\n1,F\n2,G\n2,H');
  const result = compareTables(before, after, mapping, exact);
  assert.deepEqual(result.counts, { added: 0, removed: 1, changed: 0, unchanged: 0, conflict: 2 });
  assert.equal(result.rows[0]!.before.length, 2);
  assert.equal(result.rows[0]!.after.length, 2);
  assert.equal(result.rows[1]!.before.length, 1);
  assert.equal(result.rows[1]!.after.length, 2);
  assert.equal(result.rows[0]!.reason, 'duplicate-key');
  assert.deepEqual(result.rows[0]!.changes, []);
  assertPartition(result, before, after);
});

test('duplicates existing on only one side remain conflicts', () => {
  assert.equal(diff('id,value\n1,A\n1,B', 'id,value').rows[0]!.status, 'conflict');
  assert.equal(diff('id,value', 'id,value\n1,A\n1,B').rows[0]!.status, 'conflict');
});

test('every blank or whitespace-only key remains an independent review record', () => {
  const before = parse('id,value\n,A\n ,B\n,C');
  const after = parse('id,value\n,D\n\t,E');
  const result = compareTables(before, after, mapping, exact);
  assert.equal(result.counts.conflict, 5);
  assert.ok(result.rows.every(row => row.reason === 'blank-key' && row.before.length + row.after.length === 1));
  assertPartition(result, before, after);
});

test('normalization is explicit, retained in evidence and can reveal duplicate keys', () => {
  const before = parse('id,value\n A , hello \na,other');
  const after = parse('id,value\na,HELLO');
  const unchanged = compareTables(parse('id,value\n A , hello '), after, mapping, { trimWhitespace: true, ignoreCase: true });
  assert.equal(unchanged.counts.unchanged, 1);
  assert.equal(unchanged.rows[0]!.before[0]!.values[1], ' hello ');
  const conflict = compareTables(before, after, mapping, { trimWhitespace: true, ignoreCase: true });
  assert.equal(conflict.counts.conflict, 1);
  assert.equal(conflict.rows[0]!.before.length, 2);
  assert.deepEqual(conflict.options, { trimWhitespace: true, ignoreCase: true });
  assert.equal(compareTables(parse('id,value\nA,hello'), after, mapping, exact).counts.unchanged, 0);
});

test('text identifiers, Unicode variants and whitespace are never silently coerced', () => {
  const result = diff('id,value\n0012,x\n9007199254740993,y\né,z\n 1 ,w', 'id,value\n12,x\n9007199254740992,y\né,z\n1,w');
  assert.equal(result.counts.added, 4);
  assert.equal(result.counts.removed, 4);
});

test('composite keys use collision-free encoding and all key parts must be nonblank', () => {
  const before = parse('a,b,value\nx|y,z,one\nx,y|z,two\n"[x,y]",z,three\nx,,blank');
  const after = parse('a,b,value\nx,y|z,two\n"[x,y]",z,three\nx|y,z,one\nx,,blank');
  const result = compareTables(before, after, [
    { before: 'a', after: 'a', role: 'key' }, { before: 'b', after: 'b', role: 'key' }, mapping[1]!,
  ], exact);
  assert.equal(result.counts.unchanged, 3);
  assert.equal(result.counts.conflict, 2);
  assertPartition(result, before, after);
});

test('prototype-looking keys and HTML payloads remain ordinary text', () => {
  const text = 'id,value\n__proto__,<script>alert(1)</script>\nconstructor,=SUM(A1:A2)\ntoString,hello';
  const result = diff(text, text);
  assert.equal(result.counts.unchanged, 3);
  assert.equal(result.rows[0]!.before[0]!.values[1], '<script>alert(1)</script>');
});

test('prototype-looking header names can be mapped without object-key side effects', () => {
  const table = parse('__proto__,constructor\na,value');
  const result = compareTables(table, table, [
    { before: '__proto__', after: '__proto__', role: 'key' },
    { before: 'constructor', after: 'constructor', role: 'compare' },
  ], exact);
  assert.equal(result.counts.unchanged, 1);
});

test('key-only comparisons intentionally exclude other fields', () => {
  const result = compareTables(parse('id,value\n1,old'), parse('id,value\n1,new'), [mapping[0]!], exact);
  assert.equal(result.counts.unchanged, 1);
  assert.deepEqual(result.excludedBefore, ['value']);
});

test('input tables, mappings and options are not mutated', () => {
  const before = parse('id,value\n1,A');
  const after = parse('id,value\n1,B');
  const original = JSON.stringify({ before, after, mapping, exact });
  compareTables(before, after, mapping, exact);
  assert.equal(JSON.stringify({ before, after, mapping, exact }), original);
});

test('invalid and unknown mappings, missing keys and options are rejected', () => {
  const table = parse('id,value\n1,A');
  assert.throws(() => compareTables(table, table, [], exact), /mappings/);
  assert.throws(() => compareTables(table, table, [{ ...mapping[0]!, before: 'missing' }], exact), /not found/);
  assert.throws(() => compareTables(table, table, [mapping[1]!], exact), /at least one key/);
  assert.throws(() => compareTables(table, table, [mapping[0]!, mapping[0]!], exact), /only once/);
  assert.throws(() => compareTables(table, table, mapping, { trimWhitespace: 'yes', ignoreCase: false } as never), /booleans/);
  assert.throws(() => compareTables({ ...table, rowCount: 9 }, table, mapping, exact), /row count/);
});

test('suggestions match only exact common names and prioritize ID', () => {
  const before = parse('Name,ID,email\nAda,1,a@b');
  const after = parse('email,ID,name\na@b,1,Ada');
  assert.deepEqual(suggestMappings(before, after), [
    { before: 'ID', after: 'ID', role: 'key' }, { before: 'email', after: 'email', role: 'compare' },
  ]);
  assert.deepEqual(suggestMappings(parse('id\n1'), parse('ID\n1')), []);
  assert.equal(suggestMappings(parse('Name,customer_id'), parse('customer_id,Name'))[1]!.role, 'key');
});

test('recipe validation returns a fresh, bounded configuration only', () => {
  const source = recipe();
  const result = validateRecipe(source);
  assert.deepEqual(result, source);
  assert.notEqual(result, source);
  assert.notEqual(result.mappings, source.mappings);
  assert.notEqual(result.options, source.options);
});

test('recipes reject embedded rows, unsupported fields and malicious structures', () => {
  for (const value of [null, [], 'x', { ...recipe(), rows: [] }, { ...recipe(), filename: 'secret.csv' },
    { ...recipe(), version: 2 }, { ...recipe(), options: { ...exact, unknown: true } },
    { ...recipe(), mappings: [{ ...mapping[0]!, secret: 'value' }] },
    { ...recipe(), mappings: [{ before: 'x'.repeat(4097), after: 'id', role: 'key' }] },
    { ...recipe(), mappings: Array.from({ length: 201 }, (_, index) => ({ before: `a${index}`, after: `b${index}`, role: 'key' })) },
    { ...recipe(), mappings: [{ before: 'id', after: 'id', role: '__proto__' }] },
    JSON.parse('{"format":"row-witness-recipe","version":1,"mappings":[],"options":{"trimWhitespace":false,"ignoreCase":false},"__proto__":{}}'),
  ]) assert.throws(() => validateRecipe(value));
});

test('deterministic randomized CSV roundtrips cover separators, newlines, quotes and Unicode', () => {
  let state = 0x12345678;
  const next = (): number => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const alphabet = ['a', 'é', '😀', ',', ';', '\t', '|', '"', '\r', '\n', ' ', '=', '0', '<'];
  for (let iteration = 0; iteration < 120; iteration += 1) {
    const width = 1 + next() % 7;
    const rows = Array.from({ length: 1 + next() % 15 }, () => Array.from({ length: width }, () =>
      Array.from({ length: next() % 16 }, () => alphabet[next() % alphabet.length]!).join('')));
    const delimiter = [',', ';', '\t', '|'][next() % 4] as Delimiter;
    const headers = Array.from({ length: width }, (_, index) => `column${index}`);
    const actual = parse(csv([headers, ...rows], delimiter), delimiter);
    assert.deepEqual(actual.headers, headers);
    assert.deepEqual(actual.rows.map(row => row.values), rows);
  }
});

test('randomized duplicate and blank-key comparisons partition every record once', () => {
  let state = 42;
  const next = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const make = (): Table => parse(csv([['id', 'value'], ...Array.from({ length: next() % 90 }, () => {
      const id = next() % 17;
      return [id === 0 ? '' : id === 1 ? ' ' : String(id), String(next() % 50)];
    })]));
    const before = make();
    const after = make();
    const result = compareTables(before, after, mapping, exact);
    assertPartition(result, before, after);
    for (const row of result.rows) {
      if (row.status === 'unchanged' || row.status === 'changed') {
        assert.equal(row.before.length, 1);
        assert.equal(row.after.length, 1);
      }
    }
  }
});
