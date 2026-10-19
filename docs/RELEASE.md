# Row Witness v0.2.1 — public launch

Compare two CSV exports, understand every change, and keep the source files on your device.

**[Open the browser demo](https://buzburg.github.io/row-witness/)** or download **row-witness.html** below and open it in Chrome, Edge or Firefox. Choose **Try a sample comparison** for a guided example. No installation or account required.

- Match records using one or more keys, even when columns have different names.
- See added, removed and changed records. Duplicate and blank keys keep every original row in a Needs review group.
- Export complete HTML reports, changes CSV, exact JSON evidence and reusable comparison recipes.
- The downloaded app works offline. Comparison needs no upload endpoint, AI service, telemetry or subscription.

This public-launch patch adds an online entry point, automated deployment of the verified app, and current release guidance. The comparison engine and existing visual design are unchanged.

UTF-8 CSV/TSV only: up to 10 MiB, 100,000 records, 200 columns and 2 million cells per input. Values compare as text by default. Excel workbooks, numeric tolerances and fuzzy matching are not supported. Reports include original values, including excluded fields; review before sharing.

The workflow checks TypeScript, all 56 unit tests and 36 Chromium/Firefox browser checks before publishing. SHA256SUMS.txt records the app download’s SHA-256 digest. The live demo serves the same app bytes under the filename index.html; loading that page contacts GitHub Pages, while file processing stays in your browser. Download the app for fully offline use.
