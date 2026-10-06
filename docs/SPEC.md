# Row Witness v0.1

Know what changed between two exports. A downloadable HTML application that works offline, with no account, backend, uploads, telemetry, runtime dependencies, or retained file data. MIT licensed.

## Audience and scope

People comparing customer, inventory, HR, invoice or other business exports. Match records by one or more selected columns even when the column names differ. This is deterministic text comparison, not bookkeeping, fuzzy matching, or automated import approval.

## Acceptance contract

- Parse UTF-8 CSV/TSV with quoted fields, escaped quotes, multiline cells, BOM and CRLF/LF/CR line endings. Auto-detect comma, semicolon, tab and pipe, allow explicit override, reject ambiguous or malformed input usefully. Preserve values as text, including leading zeros.
- Limit each input to 10 MiB, 100,000 data records, 200 columns and 2,000,000 cells including headers; limit header names to 512 characters. Reject binary/invalid UTF-8 input. Parse/compare in a cancellable worker so the page remains responsive.
- Explicit mappings between before and after columns; one or more key pairs; selected compare pairs. Ignore unmapped columns visibly. Reordering rows or columns must not count as a change.
- Exact matching by default. Optional trim/case folding applies to keys and compared cells and is recorded in reports. Never silently infer types, amounts or dates.
- Duplicate or blank keys are Needs review, including all conflicting records from both files. Never choose a winner or lose rows. Partitioning must account for every source record exactly once.
- Explain changed cells; searchable results and status filters, pagination, clear totals and excluded fields. Refresh/reset clears application memory; inputs are never persisted.
- Export a static HTML report, spreadsheet-hardened changes CSV and complete JSON evidence. Reports include mappings/options, SHA-256 source fingerprints, source row references and every exception; no invisible truncation. Recipes contain configuration only, no row values or filenames, and are validated on import.
- One-click realistic synthetic demo. Good keyboard, small-screen, empty/error/loading states. Accessible contrast and visible focus.
- Build one self-contained HTML file usable by double-clicking it with network disabled; also serve normally. A restrictive Content Security Policy blocks connections and external resources.
- Meaningful unit/integration/browser tests, reproducible build with lockfile, CI, contribution/license/security docs and a screenshot using synthetic data.

## Exclusions

No Excel workbook parsing, fuzzy joins, currencies/tolerances, live service connectors, writing original files, SaaS, subscriptions or AI. No claim that this category is novel or adoption is guaranteed.

## Implementation ownership

Core: `src/core.ts` and `tests/core.test.ts`. UI: `src/main.ts`, `src/styles.css`, `src/demo.ts`. Exports: `src/exports.ts`, `tests/exports.test.ts` and documentation. Shared types: `src/types.ts` (coordinate changes). Root owns build, worker, integration tests and release.
