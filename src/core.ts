import type {
  ColumnMapping, CompareOptions, Comparison, Delimiter, DelimiterChoice,
  DiffRow, Recipe, SourceRow, Table, TableMeta,
} from './types';

export const LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxRows: 100_000,
  maxColumns: 200,
  maxCells: 2_000_000,
  maxHeaderLength: 512,
});

const DELIMITERS: readonly Delimiter[] = [',', ';', '\t', '|'];
const RECIPE_NAME_LIMIT = LIMITS.maxHeaderLength;

function separatorName(delimiter: Delimiter): string {
  return delimiter === '\t' ? 'tab' : JSON.stringify(delimiter);
}

interface ParsedRecords {
  headers: string[];
  rows: SourceRow[];
  skippedBlankLines: number;
}

/** A strict CSV state machine. Record references use physical starting lines. */
function readRecords(text: string, delimiter: Delimiter, headerOnly = false): ParsedRecords {
  const result: ParsedRecords = { headers: [], rows: [], skippedBlankLines: 0 };
  let values: string[] = [];
  let value = '';
  let quoted = false;
  let closedQuote = false;
  let touched = false;
  let line = 1;
  let recordLine = 1;
  let hasHeader = false;

  const fail = (message: string): never => {
    throw new Error(`Line ${line} (record starts at line ${recordLine}): ${message}`);
  };
  const finishField = (): void => {
    values.push(value);
    if (values.length > LIMITS.maxColumns) fail(`More than ${LIMITS.maxColumns} columns.`);
    value = '';
    closedQuote = false;
  };
  const finishRecord = (): boolean => {
    if (!touched && values.length === 0 && value === '') {
      result.skippedBlankLines += 1;
      return false;
    }
    finishField();
    if (!hasHeader) {
      const seen = new Set<string>();
      for (const header of values) {
        if (!headerOnly) {
          if (!header.trim()) fail('Every column needs a nonblank header.');
          if (header.length > LIMITS.maxHeaderLength) fail(`Column headers must be at most ${LIMITS.maxHeaderLength} characters. Shorten this header before comparing.`);
          if (seen.has(header)) fail(`Duplicate header ${JSON.stringify(header)}. Rename it before comparing.`);
          seen.add(header);
        }
      }
      result.headers = values;
      hasHeader = true;
    } else {
      if (values.length !== result.headers.length) {
        fail(`Expected ${result.headers.length} fields but found ${values.length} using ${separatorName(delimiter)}. Check the delimiter and quoting.`);
      }
      if (result.rows.length >= LIMITS.maxRows) fail(`More than ${LIMITS.maxRows.toLocaleString('en-US')} data records.`);
      if ((result.rows.length + 2) * result.headers.length > LIMITS.maxCells) fail('More than 2,000,000 cells, including headers. Split this export into smaller files.');
      result.rows.push({ line: recordLine, values });
    }
    values = [];
    touched = false;
    return true;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        value += character;
        if (character === '\r') {
          if (text[index + 1] === '\n') {
            value += '\n';
            index += 1;
          }
          line += 1;
        } else if (character === '\n') line += 1;
      }
      continue;
    }
    if (character === delimiter) {
      touched = true;
      finishField();
    } else if (character === '\r' || character === '\n') {
      const completed = finishRecord();
      if (headerOnly && completed) return result;
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      line += 1;
      recordLine = line;
    } else if (closedQuote) {
      fail('Unexpected text after a closing quote. A quoted field must end at the delimiter or line ending.');
    } else if (character === '"') {
      if (value !== '') fail('Unexpected quote inside an unquoted field. Quote the entire field and double embedded quotes.');
      quoted = true;
      touched = true;
    } else {
      value += character;
      touched = true;
    }
  }
  if (quoted) fail('Unclosed quoted field.');
  if (touched || values.length > 0 || value !== '') finishRecord();
  if (!hasHeader) throw new Error('The file is empty or contains only blank lines. Include a header row.');
  return result;
}

function checkText(text: string): void {
  if (typeof text !== 'string') throw new Error('Expected text from a UTF-8 CSV or TSV file.');
  if (text.length > LIMITS.maxBytes || new TextEncoder().encode(text).byteLength > LIMITS.maxBytes) {
    throw new Error('The file exceeds the 10 MiB limit.');
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    throw new Error('Binary or unsupported control characters found. Export the file as UTF-8 CSV or TSV.');
  }
  // A direct API caller can supply invalid UTF-16 even when the file decoder cannot.
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Invalid Unicode text. Export as UTF-8.');
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('Invalid Unicode text. Export as UTF-8.');
  }
}

export function parseTable(text: string, name: string, delimiter: DelimiterChoice = 'auto'): Table {
  checkText(text);
  if (typeof name !== 'string') throw new Error('A file name is required.');
  if (delimiter !== 'auto' && !DELIMITERS.includes(delimiter)) throw new Error('Unsupported delimiter. Choose comma, semicolon, tab, or pipe.');
  const input = text.startsWith('\ufeff') ? text.slice(1) : text;
  let selected: Delimiter;
  let parsed: ParsedRecords;
  if (delimiter === 'auto') {
    const candidates: Delimiter[] = [];
    for (const candidate of DELIMITERS) {
      try {
        if (readRecords(input, candidate, true).headers.length > 1) candidates.push(candidate);
      } catch (error) {
        // An over-wide header still identifies its delimiter; the full parse reports the limit.
        if (error instanceof Error && error.message.includes(`More than ${LIMITS.maxColumns} columns`)) candidates.push(candidate);
      }
    }
    if (candidates.length === 1) {
      selected = candidates[0]!;
      parsed = readRecords(input, selected);
    } else if (candidates.length > 1) {
      const valid: { delimiter: Delimiter; records: ParsedRecords }[] = [];
      for (const candidate of candidates) {
        try { valid.push({ delimiter: candidate, records: readRecords(input, candidate) }); }
        catch { /* Full-record consistency rules out an interpretation. */ }
      }
      if (valid.length !== 1) {
        throw new Error('The delimiter is ambiguous or the records are inconsistent. Choose the delimiter explicitly and try again.');
      }
      selected = valid[0]!.delimiter;
      parsed = valid[0]!.records;
    } else {
      selected = ',';
      parsed = readRecords(input, selected);
    }
  } else {
    selected = delimiter;
    parsed = readRecords(input, selected);
  }
  return { name, ...parsed, rowCount: parsed.rows.length, delimiter: selected, sha256: '' };
}

function record(value: unknown, keys: readonly string[], description: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${description} must be an object.`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error(`${description} has missing or unsupported fields.`);
  }
  return value as Record<string, unknown>;
}

function validatedOptions(value: unknown): CompareOptions {
  const options = record(value, ['trimWhitespace', 'ignoreCase'], 'Comparison options');
  if (typeof options.trimWhitespace !== 'boolean' || typeof options.ignoreCase !== 'boolean') {
    throw new Error('Comparison options must be booleans.');
  }
  return { trimWhitespace: options.trimWhitespace, ignoreCase: options.ignoreCase };
}

function validatedMappings(value: unknown): ColumnMapping[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > LIMITS.maxColumns) {
    throw new Error(`Choose between 1 and ${LIMITS.maxColumns} column mappings.`);
  }
  const before = new Set<string>();
  const after = new Set<string>();
  const mappings = value.map(item => {
    const mapping = record(item, ['before', 'after', 'role'], 'Column mapping');
    if (typeof mapping.before !== 'string' || typeof mapping.after !== 'string'
      || !mapping.before.trim() || !mapping.after.trim()
      || mapping.before.length > RECIPE_NAME_LIMIT || mapping.after.length > RECIPE_NAME_LIMIT) {
      throw new Error(`Column names must be nonblank text of at most ${RECIPE_NAME_LIMIT} characters.`);
    }
    if (mapping.role !== 'key' && mapping.role !== 'compare') throw new Error('Each mapping role must be key or compare.');
    if (before.has(mapping.before) || after.has(mapping.after)) throw new Error('Each column can be mapped only once on each side.');
    before.add(mapping.before);
    after.add(mapping.after);
    return { before: mapping.before, after: mapping.after, role: mapping.role } as ColumnMapping;
  });
  if (!mappings.some(mapping => mapping.role === 'key')) throw new Error('Choose at least one key column to identify records.');
  return mappings;
}

export function validateRecipe(value: unknown): Recipe {
  const recipe = record(value, ['format', 'version', 'mappings', 'options'], 'Recipe');
  if (recipe.format !== 'row-witness-recipe' || recipe.version !== 1) throw new Error('This is not a supported Row Witness version 1 recipe.');
  return {
    format: 'row-witness-recipe', version: 1,
    mappings: validatedMappings(recipe.mappings), options: validatedOptions(recipe.options),
  };
}

export function suggestMappings(before: Table, after: Table): ColumnMapping[] {
  const available = new Set(after.headers);
  const common = before.headers.filter(header => available.has(header));
  const exactId = common.find(header => /^(id|uuid)$/i.test(header));
  const likelyId = common.find(header => /^(sku|email|key|employeeid|customerid|invoiceid|orderid|productid|recordid)$/i.test(header) || /[ _-](id|uuid|key)$/i.test(header));
  const key = exactId ?? likelyId ?? common[0];
  return common.map(header => ({ before: header, after: header, role: header === key ? 'key' : 'compare' }));
}

function tableMeta(table: Table): TableMeta {
  return {
    name: table.name, headers: [...table.headers], rowCount: table.rowCount,
    delimiter: table.delimiter, skippedBlankLines: table.skippedBlankLines, sha256: table.sha256,
  };
}

function validateTable(table: Table): void {
  if (!Array.isArray(table.headers) || table.headers.length < 1 || table.headers.length > LIMITS.maxColumns
    || table.headers.some(header => typeof header !== 'string' || !header.trim() || header.length > LIMITS.maxHeaderLength)
    || new Set(table.headers).size !== table.headers.length) throw new Error('Invalid or duplicate table headers. Parse the file again.');
  if (!Array.isArray(table.rows) || table.rows.length > LIMITS.maxRows || table.rowCount !== table.rows.length) {
    throw new Error('Invalid table row count. Parse the file again.');
  }
  for (const row of table.rows) {
    if (!Number.isSafeInteger(row.line) || row.line < 1 || !Array.isArray(row.values)
      || row.values.length !== table.headers.length || row.values.some(value => typeof value !== 'string')) {
      throw new Error('Invalid source record. Parse the file again.');
    }
  }
  if ((table.rows.length + 1) * table.headers.length > LIMITS.maxCells) throw new Error('More than 2,000,000 cells, including headers.');
}

export function compareTables(before: Table, after: Table, mappings: ColumnMapping[], options: CompareOptions): Comparison {
  validateTable(before);
  validateTable(after);
  const chosenMappings = validatedMappings(mappings);
  const chosenOptions = validatedOptions(options);
  const pairs = chosenMappings.map(mapping => {
    const left = before.headers.indexOf(mapping.before);
    const right = after.headers.indexOf(mapping.after);
    if (left < 0 || right < 0) throw new Error(`Mapped column ${JSON.stringify(left < 0 ? mapping.before : mapping.after)} was not found. Review the mappings.`);
    return { ...mapping, left, right };
  });
  const keys = pairs.filter(pair => pair.role === 'key');
  const compared = pairs.filter(pair => pair.role === 'compare');
  const normalize = (value: string): string => {
    const trimmed = chosenOptions.trimWhitespace ? value.trim() : value;
    return chosenOptions.ignoreCase ? trimmed.toLowerCase() : trimmed;
  };
  const keyParts = (row: SourceRow, side: 'left' | 'right'): string[] => keys.map(pair => row.values[pair[side]]!);
  const encodedKey = (row: SourceRow, side: 'left' | 'right'): string | null => {
    const parts = keyParts(row, side).map(normalize);
    // Whitespace-only identifiers are missing identifiers even in exact comparison mode.
    return parts.some(part => part.trim() === '') ? null : JSON.stringify(parts);
  };
  const group = (table: Table, side: 'left' | 'right'): Map<string, SourceRow[]> => {
    const grouped = new Map<string, SourceRow[]>();
    for (const row of table.rows) {
      const encoded = encodedKey(row, side);
      if (encoded === null) continue;
      const bucket = grouped.get(encoded);
      if (bucket) bucket.push(row);
      else grouped.set(encoded, [row]);
    }
    return grouped;
  };
  const leftGroups = group(before, 'left');
  const rightGroups = group(after, 'right');
  const result: Comparison = {
    before: tableMeta(before), after: tableMeta(after), mappings: chosenMappings, options: chosenOptions,
    rows: [], counts: { added: 0, removed: 0, changed: 0, unchanged: 0, conflict: 0 },
    excludedBefore: before.headers.filter(header => !chosenMappings.some(mapping => mapping.before === header)),
    excludedAfter: after.headers.filter(header => !chosenMappings.some(mapping => mapping.after === header)),
  };
  const append = (row: DiffRow): void => { result.rows.push(row); result.counts[row.status] += 1; };
  const visited = new Set<string>();
  for (const side of ['left', 'right'] as const) {
    for (const source of (side === 'left' ? before : after).rows) {
      const encoded = encodedKey(source, side);
      if (encoded === null) {
        append({ status: 'conflict', key: keyParts(source, side), before: side === 'left' ? [source] : [], after: side === 'right' ? [source] : [], changes: [], reason: 'blank-key' });
        continue;
      }
      if (visited.has(encoded)) continue;
      visited.add(encoded);
      const left = leftGroups.get(encoded) ?? [];
      const right = rightGroups.get(encoded) ?? [];
      const row: DiffRow = { status: 'unchanged', key: keyParts(source, side), before: left, after: right, changes: [] };
      if (left.length > 1 || right.length > 1) {
        row.status = 'conflict';
        row.reason = 'duplicate-key';
      } else if (left.length === 0) row.status = 'added';
      else if (right.length === 0) row.status = 'removed';
      else {
        for (const pair of compared) {
          const oldValue = left[0]!.values[pair.left]!;
          const newValue = right[0]!.values[pair.right]!;
          if (normalize(oldValue) !== normalize(newValue)) {
            row.changes.push({ beforeColumn: pair.before, afterColumn: pair.after, before: oldValue, after: newValue });
          }
        }
        if (row.changes.length > 0) row.status = 'changed';
      }
      append(row);
    }
  }
  return result;
}
