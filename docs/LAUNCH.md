# Launch copy — prepared, not posted

These drafts have not been sent or published. Before using them, verify the repository visibility, release download and demo, and replace any feature statement that no longer matches the shipped build. The screenshot and example files must use synthetic data.

## GitHub description

Compare CSV exports offline. Map columns, review duplicate keys, and download complete reports. One HTML file, no account or uploads.

## Short announcement

I built Row Witness for the “what changed between these two exports?” job.

Open one HTML file, select two CSVs, and choose the columns that identify a record. It shows added, removed and changed records. If a key is blank or duplicated, it keeps every conflicting row together for review instead of choosing a match.

It works offline, preserves identifiers as text, and exports a complete HTML report, changes CSV or JSON evidence. No account, backend, AI service or file upload. MIT licensed.

There are already good tools in this space. My focus is a small downloadable app with clear handling of ambiguous records and reports you can inspect later.

Repository: https://github.com/Buzburg/row-witness

I'd especially value feedback from people comparing inventory, customer or operational exports. A small synthetic file that breaks it is more useful than a star.

## A 45-second demo

1. Open `row-witness.html` with the network disabled.
2. Choose **Try a sample comparison** to load the synthetic customer exports.
3. Show a changed value, an added record and a removed record.
4. Show a duplicate-key Needs review group with all original records.
5. Point out the selected mappings and excluded columns.
6. Download the HTML report, open it, and show that it contains the complete results and source references.

## Release notes for v0.1.0

First release of Row Witness: a standalone offline CSV comparison application with explicit column mapping, compound keys, optional normalization, review groups for ambiguous keys, configuration recipes, and HTML/CSV/JSON exports.

Limits: UTF-8 CSV/TSV only; 10 MiB, 100,000 records, 200 columns and 2,000,000 cells including headers per input. Header names have a 512-character limit. HTML reports over the 64,000,000-character budget are explicitly refused; they are never truncated. No Excel files, numeric/date conversion, fuzzy matching, live connectors or changes to original files. Large reports can use substantial memory. Review important results against the source exports before acting on them.

The CSV export mitigates common spreadsheet formula prefixes; HTML and JSON retain exact original strings. Reports include original values from excluded fields, so review them before sharing.
