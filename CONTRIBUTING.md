# Contributing

Small, well-explained fixes are welcome. Please discuss substantial new formats or services in an issue first so the application can remain a simple offline utility.

## Local setup

Install Node.js 22 or later, then:

```sh
npm ci
npm run check
npm test
npm run build
npx playwright install chromium firefox
npm run test:e2e
```

On Linux, Playwright may also need system browser dependencies (`npx playwright install --with-deps chromium firefox`). Use your environment's normal installation and permission process. The single-file application is generated at `dist/row-witness.html`.

## What to preserve

- Input values remain strings. Do not silently coerce identifiers, amounts, or dates.
- Every source record belongs to exactly one comparison group. Duplicate and blank keys remain reviewable exceptions; never overwrite a record while constructing a key index.
- User-visible counts distinguish comparison groups from original source records.
- Mappings, normalization options, exclusions, source references and fingerprints remain visible in reports.
- UI pagination and filtering must never silently truncate or redact exports.
- Keep arbitrary input out of HTML markup and JavaScript. Escape text in reports, retain the Content Security Policy, and keep the application free of network requests and persistent source-data storage.
- Configuration recipes contain configuration only. Validate imported recipes before use.
- Preserve keyboard access, responsive layouts, error states and cancellation.

## A useful pull request

Explain the actual failing input and the expected result. Include the smallest synthetic CSV example that reproduces the problem, a regression test for meaningful behavior, and the relevant check results. Do not use real customer or employee data in tests or screenshots.

Parser fixes should exercise malformed quoting, embedded line endings, delimiters, encodings or limits as appropriate. Matching fixes should verify source-record accounting and ambiguous keys. Export fixes should check exact preservation in JSON/HTML, spreadsheet formula mitigation, text escaping, and complete output beyond the visible page.

Do not add an external service, analytics, remote assets, or a runtime library download to solve a local workflow. Keep the lockfile current when changing build dependencies. No feature is complete until the generated HTML file works with network access disabled.
