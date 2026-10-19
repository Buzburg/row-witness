# Launch readiness — Row Witness

Reviewed October 19, 2026 for the v0.2.1 public launch.

Row Witness is a focused, complete offline CSV comparison app with a guided synthetic example, standalone downloads and documented limits. The comparison engine and existing appearance are unchanged in this release.

Local release checks passed: clean dependency installation, strict TypeScript checking, 56 unit tests, 36 Chromium/Firefox browser checks, a standalone build, and 160 independent parser fixtures. The locked development dependency audit reported no known vulnerabilities at the time of verification.

The public release offers an [online demo](https://buzburg.github.io/row-witness/) and an [offline download](https://github.com/Buzburg/row-witness/releases/latest). The release workflow tests the build before publishing and deploys the identical HTML app to GitHub Pages. See [verification details](docs/VERIFICATION.md) and [hosted workflow results](https://github.com/Buzburg/row-witness/actions) for evidence and deployment status.

Claims remain limited to supported UTF-8 CSV/TSV comparison. Every optional CSV dialect, browser extension, spreadsheet importer and device has not been verified. Real customer files were not used. Popularity and commercial adoption have not been measured.
