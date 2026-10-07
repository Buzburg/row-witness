# Release verification

Local verification performed on 2026-10-06 with synthetic fixtures. This documents tested behavior, not a guarantee for all files, browsers or devices.

- TypeScript strict mode, unchecked-index checks and exact optional properties pass.
- 56 unit tests cover parsing, matching, ambiguity, output escaping, record accounting, recipes, worker concurrency/cancellation and report bounds.
- 18 browser scenarios pass in Chromium and Firefox (36 checks). They exercise offline `file://` use, no application HTTP requests, real downloads, UTF-8 BOM fingerprints, differently named composite keys, malicious-looking data, stale-result protection, recipe/search timing, malformed/oversized inputs, 20,000 records, independent offline HTML reports, keyboard access and viewport widths 320/768/1024/1440.
- Five new sample scenarios verify the one-click result guide, correct filters and original values, reduced-motion scrolling, keyboard focus after dismissal, removal after rules/mappings/reset/recomparison, delayed manual file reads, and rules changing during asynchronous parsing or comparison. The last two cases must not publish a completed sample or its guide.
- Automated axe WCAG A/AA checks cover empty, completed and expanded-detail/mobile states. These are automated checks, not a complete accessibility audit.
- A separate parser check agrees with Python's CSV reader on 160 deterministic fixtures. [Method and local timing results](BENCHMARK.md).
- Production has no package dependencies. The development dependency audit found no known vulnerabilities at the time of the check.

The sample-guide update was checked with Node.js 25.9.0 and Playwright 1.58.2 on Windows. Firefox needed browser-profile access outside the filesystem sandbox; its initial sandboxed attempts failed before creating a page. Chromium passed all 18 scenarios, Firefox passed 17 on the full run, and the remaining delayed-import test passed in both browsers after adding its missing wait for the second input to finish reading. A subsequent reduced-motion improvement passed the guide, normal comparison/export, keyboard and accessibility cases in both browsers (6 checks). The refreshed screenshots were captured from the real standalone HTML using synthetic fixtures.

The release workflow repeats typing, unit tests and both browser suites on Ubuntu with Node.js 22 before publishing the standalone HTML and its SHA-256 checksum. See the [workflow runs](https://github.com/Buzburg/row-witness/actions) for hosted execution status.

Not tested: real private customer exports, Excel import behavior across spreadsheet products, every CSV dialect, assistive-technology usability, mobile Safari, and arbitrarily large reports. Source files and the supplied fixtures stay unchanged. No adoption or commercial results have been measured.
