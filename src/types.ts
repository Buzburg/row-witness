export type Delimiter = ',' | ';' | '\t' | '|';
export type DelimiterChoice = Delimiter | 'auto';
export type RowStatus = 'added' | 'removed' | 'changed' | 'unchanged' | 'conflict';

export interface TableMeta {
  name: string;
  headers: string[];
  rowCount: number;
  delimiter: Delimiter;
  skippedBlankLines: number;
  sha256: string;
}

export interface SourceRow { line: number; values: string[] }
export interface Table extends TableMeta { rows: SourceRow[] }
export interface ColumnMapping { before: string; after: string; role: 'key' | 'compare' }
export interface CompareOptions { trimWhitespace: boolean; ignoreCase: boolean }
export interface CellChange { beforeColumn: string; afterColumn: string; before: string; after: string }
export interface DiffRow {
  status: RowStatus;
  key: string[];
  before: SourceRow[];
  after: SourceRow[];
  changes: CellChange[];
  reason?: 'blank-key' | 'duplicate-key';
}
export interface Comparison {
  before: TableMeta;
  after: TableMeta;
  mappings: ColumnMapping[];
  options: CompareOptions;
  rows: DiffRow[];
  counts: Record<RowStatus, number>;
  excludedBefore: string[];
  excludedAfter: string[];
}
export interface Recipe {
  format: 'row-witness-recipe';
  version: 1;
  mappings: ColumnMapping[];
  options: CompareOptions;
}
export interface SourceInput { name: string; text: string; delimiter: DelimiterChoice }
export type WorkerRequest =
  | { id: number; action: 'parse'; source: SourceInput }
  | { id: number; action: 'compare'; before: Table; after: Table; mappings: ColumnMapping[]; options: CompareOptions };
export type WorkerResponse =
  | { id: number; ok: true; action: 'parse'; table: Table }
  | { id: number; ok: true; action: 'compare'; comparison: Comparison }
  | { id: number; ok: false; error: string };
