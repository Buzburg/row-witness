import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem, platform, release, arch } from 'node:os';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';

// Synthetic data only. This benchmark does not read any customer files.
await mkdir('.test-build', { recursive: true });
await build({ entryPoints: ['src/core.ts'], outfile: '.test-build/benchmark-core.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22' });
const { parseTable, compareTables } = await import(pathToFileURL(resolve('.test-build/benchmark-core.mjs')).href);

const options = { trimWhitespace: false, ignoreCase: false };
const headers = ['id', 'name', 'department', 'city', 'status', 'plan', 'owner', 'notes'];
const mappings = headers.map(header => ({ before: header, after: header, role: header === 'id' ? 'key' : 'compare' }));
const csv = (rows, delimiter = ',') => rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(delimiter)).join('\r\n');

function scenario(size) {
  const rows = Array.from({ length: size }, (_, index) => [
    `R${String(index).padStart(7, '0')}`, `Person ${index}`, `Dept ${index % 12}`,
    ['London', 'Austin', 'Toronto', 'Tokyo'][index % 4], 'active', ['basic', 'plus'][index % 2],
    `Team ${index % 7}`, `Synthetic ${index}`,
  ]);
  const after = rows.filter((_, index) => index !== 0 && index !== 3).map(row => [...row]).reverse();
  after.find(row => row[0] === rows[1][0])[4] = 'paused';
  after.push([...rows[2]], ['RNEW0001', 'New record', 'Department 0', 'Austin', 'active', 'basic', 'Team 0', 'Synthetic addition']);
  return { before: csv([headers, ...rows]), after: csv([headers, ...after]) };
}

function verify(result, size) {
  assert.deepEqual(result.counts, { added: 1, removed: 2, changed: 1, unchanged: size - 4, conflict: 1 });
  assert.equal(result.rows.reduce((sum, row) => sum + row.before.length, 0), size);
  assert.equal(result.rows.reduce((sum, row) => sum + row.after.length, 0), size);
  assert.equal(new Set(result.rows.flatMap(row => row.before)).size, size);
  assert.equal(new Set(result.rows.flatMap(row => row.after)).size, size);
  const conflict = result.rows.find(row => row.status === 'conflict');
  assert.equal(conflict.reason, 'duplicate-key');
  assert.equal(conflict.before.length, 1);
  assert.equal(conflict.after.length, 2);
}

function measure(input, size) {
  global.gc?.();
  const start = performance.now();
  const before = parseTable(input.before, 'before.csv', ',');
  const middle = performance.now();
  const after = parseTable(input.after, 'after.csv', ',');
  const parsed = performance.now();
  const comparison = compareTables(before, after, mappings, options);
  const end = performance.now();
  verify(comparison, size);
  return { beforeParseMs: middle - start, afterParseMs: parsed - middle, compareMs: end - parsed, totalMs: end - start };
}

function differential(python) {
  if (!python) return { status: 'not run', reason: 'Set ROW_WITNESS_PYTHON to a Python 3 executable to compare against its csv module.' };
  let state = 0xa18325f7;
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const alphabet = ['a', 'é', '😀', ',', ';', '\t', '|', '"', '\r', '\n', ' ', '=', '0', '<', '\u2028'];
  const fixtures = Array.from({ length: 160 }, () => {
    const width = 1 + next() % 8;
    const rows = Array.from({ length: 1 + next() % 20 }, () => Array.from({ length: width }, () =>
      Array.from({ length: next() % 20 }, () => alphabet[next() % alphabet.length]).join('')));
    const delimiter = [',', ';', '\t', '|'][next() % 4];
    return { delimiter, text: csv([Array.from({ length: width }, (_, index) => `column${index}`), ...rows], delimiter) };
  });
  const source = `import csv,io,json,sys\nfixtures=json.loads(sys.stdin.buffer.read().decode('utf-8'))\nresults=[]\nfor fixture in fixtures:\n reader=csv.reader(io.StringIO(fixture['text'],newline=''),delimiter=fixture['delimiter'],strict=True)\n rows=[]\n starts=[]\n previous=0\n for row in reader:\n  rows.append(row)\n  starts.append(previous+1)\n  previous=reader.line_num\n results.append({'rows':rows,'starts':starts})\nsys.stdout.buffer.write(json.dumps({'python':sys.version,'results':results},ensure_ascii=True).encode('ascii'))\n`;
  const reference = spawnSync(python, ['-c', source], { input: JSON.stringify(fixtures), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (reference.status !== 0) throw new Error(`Python differential failed: ${reference.error?.message ?? reference.stderr}`);
  const parsed = JSON.parse(reference.stdout);
  fixtures.forEach((fixture, index) => {
    const table = parseTable(fixture.text, `fixture-${index}`, fixture.delimiter);
    assert.deepEqual([table.headers, ...table.rows.map(row => row.values)], parsed.results[index].rows);
    assert.deepEqual([1, ...table.rows.map(row => row.line)], parsed.results[index].starts);
  });
  return { status: 'passed', cases: fixtures.length, python: parsed.python, fields: 'all parsed strings and physical record starting lines' };
}

measure(scenario(1_000), 1_000); // One unreported warmup; no measured data is discarded.
const results = [20_000, 100_000].map(size => {
  const input = scenario(size);
  const trials = Array.from({ length: 3 }, () => measure(input, size));
  return {
    recordsPerInput: size, columns: headers.length,
    beforeBytes: Buffer.byteLength(input.before), afterBytes: Buffer.byteLength(input.after),
    trials, medianMs: [...trials.map(trial => trial.totalMs)].sort((a, b) => a - b)[1],
    expectedCounts: { added: 1, removed: 2, changed: 1, unchanged: size - 4, conflict: 1 },
  };
});
const report = {
  measuredAt: new Date().toISOString(),
  machine: { cpu: cpus()[0]?.model ?? 'unavailable', logicalCpus: cpus().length, memoryBytes: totalmem(), platform: platform(), release: release(), architecture: arch() },
  node: process.version, explicitGc: typeof global.gc === 'function', results,
  differential: differential(process.env.ROW_WITNESS_PYTHON),
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--report')) {
  const rows = results.flatMap(result => result.trials.map((trial, index) => `| ${result.recordsPerInput.toLocaleString('en-US')} | ${index + 1} | ${trial.beforeParseMs.toFixed(1)} | ${trial.afterParseMs.toFixed(1)} | ${trial.compareMs.toFixed(1)} | ${trial.totalMs.toFixed(1)} |`));
  const text = `# Local benchmark and independent parser check\n\nMeasured ${report.measuredAt}. This is one local Node.js measurement, not a cross-device performance guarantee or a browser rendering benchmark.\n\n## Environment\n\n- CPU: ${report.machine.cpu}; ${report.machine.logicalCpus} logical CPUs.\n- RAM reported by the operating system: ${(report.machine.memoryBytes / 1024 ** 3).toFixed(2)} GiB.\n- OS: ${report.machine.platform} ${report.machine.release}, ${report.machine.architecture}.\n- Runtime: Node.js ${report.node}. Explicit garbage collection before each trial: ${report.explicitGc ? 'yes' : 'no'}.\n\n## Method\n\nThree measured trials at each size after one unreported 1,000-record warmup. Each input has eight string columns. The after file reverses row order, changes one compared cell, removes two IDs, adds one new ID, and duplicates an existing ID. Input creation and assertions are outside the timed section. Parsing both inputs and comparison are included; hashing, file reading, worker messages, rendering and exports are excluded. A comma delimiter is selected explicitly.\n\nEvery trial verifies exact expected status counts, all source-record accounting, no duplicate record references, and inclusion of all three source records in the duplicate-key group.\n\n| Records per input | Trial | Parse before (ms) | Parse after (ms) | Compare (ms) | Total (ms) |\n|---:|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n\n${results.map(result => `- ${result.recordsPerInput.toLocaleString('en-US')} records: median ${result.medianMs.toFixed(1)} ms; source sizes ${result.beforeBytes.toLocaleString('en-US')} / ${result.afterBytes.toLocaleString('en-US')} bytes.`).join('\n')}\n\n## Independent CSV reference\n\n${report.differential.status === 'passed' ? `Passed ${report.differential.cases} deterministic valid CSV fixtures against Python's standard-library \`csv.reader(strict=True)\`. Compared every parsed string and physical record starting line. Fixtures include all four supported delimiters, embedded CR/LF, escaped quotes, empty fields, emoji, accented text, and Unicode line separators. Python: ${report.differential.python.replaceAll('\n', ' ')}.\n\nThis establishes agreement for these valid fixtures, not all possible CSV dialects. Row Witness intentionally rejects ambiguous delimiters, duplicate/blank headers, inconsistent widths and binary controls; Python's acceptance of some other inputs is not the product contract.` : report.differential.reason}\n\n## Reproduce\n\nAfter \`npm ci\`, set \`ROW_WITNESS_PYTHON\` to a Python 3 executable for the optional independent check, then run:\n\n\`\`\`sh\nnode --expose-gc scripts/benchmark.mjs --report\n\`\`\`\n\nThe script uses synthetic data, prints its full JSON measurements, and refreshes this document when \`--report\` is supplied. It needs no Python packages. Timings vary with hardware, runtime, memory pressure and other running applications.\n`;
  await writeFile('docs/BENCHMARK.md', text);
}
