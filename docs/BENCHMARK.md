# Local benchmark and independent parser check

Measured 2026-10-06T07:16:55.526Z. This is one local Node.js measurement, not a cross-device performance guarantee or a browser rendering benchmark.

## Environment

- CPU: AMD Ryzen 9 5980HX with Radeon Graphics        ; 16 logical CPUs.
- RAM reported by the operating system: 15.41 GiB.
- OS: win32 10.0.26200, x64.
- Runtime: Node.js v25.9.0. Explicit garbage collection before each trial: yes.

## Method

Three measured trials at each size after one unreported 1,000-record warmup. Each input has eight string columns. The after file reverses row order, changes one compared cell, removes two IDs, adds one new ID, and duplicates an existing ID. Input creation and assertions are outside the timed section. Parsing both inputs and comparison are included; hashing, file reading, worker messages, rendering and exports are excluded. A comma delimiter is selected explicitly.

Every trial verifies exact expected status counts, all source-record accounting, no duplicate record references, and inclusion of all three source records in the duplicate-key group.

| Records per input | Trial | Parse before (ms) | Parse after (ms) | Compare (ms) | Total (ms) |
|---:|---:|---:|---:|---:|---:|
| 20,000 | 1 | 31.1 | 29.4 | 70.3 | 130.7 |
| 20,000 | 2 | 22.6 | 26.2 | 84.4 | 133.2 |
| 20,000 | 3 | 21.7 | 20.6 | 72.5 | 114.9 |
| 100,000 | 1 | 136.8 | 155.8 | 421.4 | 714.0 |
| 100,000 | 2 | 140.2 | 175.4 | 426.3 | 742.0 |
| 100,000 | 3 | 150.9 | 165.4 | 401.1 | 717.4 |

- 20,000 records: median 130.7 ms; source sizes 1,751,175 / 1,751,193 bytes.
- 100,000 records: median 717.4 ms; source sizes 8,844,509 / 8,844,527 bytes.

## Independent CSV reference

Passed 160 deterministic valid CSV fixtures against Python's standard-library `csv.reader(strict=True)`. Compared every parsed string and physical record starting line. Fixtures include all four supported delimiters, embedded CR/LF, escaped quotes, empty fields, emoji, accented text, and Unicode line separators. Python: 3.12.14 (main, Aug 25 2026, 14:01:42) [MSC v.1944 64 bit (AMD64)].

This establishes agreement for these valid fixtures, not all possible CSV dialects. Row Witness intentionally rejects ambiguous delimiters, duplicate/blank headers, inconsistent widths and binary controls; Python's acceptance of some other inputs is not the product contract.

## Reproduce

After `npm ci`, set `ROW_WITNESS_PYTHON` to a Python 3 executable for the optional independent check, then run:

```sh
node --expose-gc scripts/benchmark.mjs --report
```

The script uses synthetic data, prints its full JSON measurements, and refreshes this document when `--report` is supplied. It needs no Python packages. Timings vary with hardware, runtime, memory pressure and other running applications.
