# Launch readiness — row-witness

Reviewed October 17, 2026. Visibility has not been changed by this review.

**Recommendation: Launch first.**

A clear offline CSV comparison product with a standalone download. 56 unit tests and 18 local Chromium browser tests passed; types, build and npm audit passed. Current baseline CI also checks Firefox.

## Scope and limits

No hosted service required. Keep claims limited to supported CSV comparison; no guarantee for every encoding or dataset.

## Evidence

Baseline reviewed: `b3aae023e9703bdaf38b2f00a6a3c44e955665b0`. Documentation and focused corrections may follow this baseline; check CI on the final commit before releasing.

Local checks used Linux x86-64, Python 3.12.14, Node 26.8.1, the installed Rust toolchain, and Mojo 1.1.0 where relevant. Native/Python/HTTP coverage is distinguished; a passing subset is not a full product certification.

- `types`: PASS.
- `audit`: PASS.
- `unit`: PASS — ℹ tests 56.
- `browser-local`: PASS — 18 passed (13.5s).
- `build`: PASS.
- Baseline hosted workflow [Release](https://github.com/Buzburg/row-witness/actions/runs/37566355264): success.
- Baseline hosted workflow [Verify](https://github.com/Buzburg/row-witness/actions/runs/37566355232): success.
- Baseline hosted workflow [Verify](https://github.com/Buzburg/row-witness/actions/runs/37566353906): success.

Detailed command logs and setup diagnostics are retained in the private local launch-review workspace. Browser checks used installed Chromium; matching baseline CI includes the configured browser matrix. Downloading the pinned browser bundle timed out locally, so this review does not claim a new local Firefox run.
