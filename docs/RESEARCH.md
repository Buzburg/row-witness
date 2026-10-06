# Why Row Witness exists

Research date: 2026-10-06. These are public problem signals and examples of existing tools, not a market-size estimate or a guarantee of adoption.

## The practical problem

Exports are often the common interface between business systems. People still need to identify what changed when rows move, column names differ, or records are duplicated. A plain text diff and a spreadsheet lookup can make these cases hard to review.

Three concrete requests guided the scope:

- A [February 2025 HR/Active Directory comparison request](https://www.reddit.com/r/PowerShell/comments/1itfh06/compare_two_csv_files/) asks to match EmployeeID and find changed departments or job titles.
- A [request for a free CSV comparison utility](https://www.reddit.com/r/software/comments/13i18vn/) describes tools that compare row positions instead of the same records, producing confusing differences.
- A [December 2024 discussion](https://www.reddit.com/r/dataengineering/comments/1h5tjf0/) asks how to identify which cells changed between CSV files.

These are public examples of recurring problems, not interviews or evidence that these users want this particular implementation.

Current tools provide stronger evidence that the category is established. Their existence is a reason to keep the scope specific and acknowledge alternatives.

## Existing alternatives

| Project | What it already offers | Why a user might choose it |
| --- | --- | --- |
| [Dataloupe](https://github.com/aurelio-nakamura/dataloupe) | Local data exploration, keyed differences across multiple file formats, standalone HTML and a GitHub Action. | Command-line and CI workflows, Excel or Parquet, and broader analysis. |
| [doff](https://github.com/franklioxygen/doff) | A local workspace for text, image, document, spreadsheet and folder comparison, with offline and desktop options. | Multiple kinds of files in one application. |
| [csv-diff](https://github.com/simonw/csv-diff) | A command-line tool for inspecting differences between CSV files. | Scripts and an established CLI workflow. |
| [csv-diff-browser](https://github.com/SaurabhBaranawal/csv-diff-browser) | Browser-local CSV comparison with filters, column selection and pagination. | An existing focused browser interface. |

The [csvkit.org comparison tool documentation](https://csvkit.org/csv-diff) explicitly describes a last-row choice when a key repeats. That is a concrete design tradeoff. Row Witness instead groups ambiguous keys for human review and keeps all source records. This observation applies to that documented tool, not every CSV library or competitor.

## The chosen scope

Row Witness combines a downloadable HTML file with explicit before/after column mapping, conservative handling of blank or duplicated keys, complete source-record accounting, reusable configuration recipes, and detailed exports. No account, backend or model is needed.

These features are **product choices**, not claims that nobody else has implemented them. The focus is a clear, inspectable workflow for someone comparing business exports without installing a data stack. It is not bookkeeping software, an automatic reconciliation authority, or an instruction to import the results into another system.

## What remains unvalidated

- There have been no user interviews or usability studies for Row Witness.
- Public discussions and competitor features do not demonstrate that users will switch tools or recommend this one.
- Actual customer data patterns, preferred formats, accessibility needs and large-file behavior require continued testing and feedback.
- Immediate popularity cannot be promised. A complete working demo, accurate documentation and fast response to real bugs are the useful first steps.

## First feedback to seek

Ask people who regularly compare inventory, customer or operational exports to complete one real comparison locally. Check whether they can select the right key, understand Needs review groups, explain excluded fields, and produce a useful report. Use synthetic examples in public bug reports and demonstrations.
