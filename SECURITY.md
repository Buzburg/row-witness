# Security and privacy

Row Witness processes untrusted input files locally. It has no account system, server API, upload endpoint, or telemetry. The distributed HTML file includes its application code and worker; it does not fetch runtime libraries, fonts, or scripts. A restrictive Content Security Policy blocks network connections and external resources.

Source records and filenames live in application memory during a session. The application does not store them in localStorage, IndexedDB, cookies, or a remote service. Reset or reload to clear the current session. This does not erase downloads or guarantee memory erasure against other software on the device.

## Data handling boundaries

- The application reads files selected by the user and offers newly generated downloads. It does not overwrite or edit the originals.
- HTML reports escape input text, contain no scripts, and declare their own restrictive Content Security Policy.
- CSV exports prefix common spreadsheet formula-like values with an apostrophe. Spreadsheet programs and import options differ; this mitigation is not a universal guarantee. Prefer the static HTML report for viewing unfamiliar data and JSON for exact machine-readable strings.
- JSON evidence and HTML reports retain **all original values**, including unchanged rows and excluded fields. CSV reports retain all original fields of included source records. Filters do not redact exports. These reports can contain sensitive source information.
- A configuration recipe omits records and filenames, but contains column names. Review it before sharing.
- SHA-256 fingerprints identify source-file bytes. They are not signatures, do not authenticate an author, and do not prove the data is accurate. Someone who can edit a report can also alter its displayed fingerprints.
- Input limits bound individual files, records, columns and cells. Headers are limited to 512 characters. HTML report generation checks a 64,000,000-character budget incrementally and refuses oversized reports instead of truncating them. Large HTML/JSON/CSV exports can still use substantial memory. Browser extensions, developer tools, compromised dependencies, and other software on the computer are outside the application's privacy boundary.

## Reporting a problem

For ordinary bugs, open an issue with a minimal **synthetic** example. Do not attach customer files, credentials, personal data, or private exports.

For a vulnerability that could expose data or execute attacker-controlled content, use GitHub's private vulnerability reporting option if it is enabled for this repository. Otherwise, contact the maintainer using a verified private contact method on their GitHub profile before publishing exploit details. No response time or security support contract is promised.

Only the latest release is intended to receive fixes. Rebuild from the current reviewed source or replace your downloaded HTML file when a security fix is released.
