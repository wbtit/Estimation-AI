# Phase 4d coverage run (counts only)

Run on the six text-layer documents of the Phase 4c survey (anonymous ids), large pages only, with `worker/tools/text_coverage.py`. **This measures coverage, not correctness.** There is no ground truth for these documents, so nothing here says that a parsed value is right; it says how much of what looks like a profile, a dimension, a sheet number or a scale was accepted by the parsers. "Profile-like" and "dimension-like" come from deliberately loose patterns, so the shares also depend on what those patterns consider to look like a profile. No page was viewed, and no text or name is printed or stored in the result.

Pages measured: 136 large pages in total, all with a usable text layer (no page was rejected as garbled).

| Doc | Pages | Profile-like tokens | Parsed | Dimension-like tokens | Parsed | Sheet number found | Scale found (exactly one) | Title found |
|---|---|---|---|---|---|---|---|---|
| job-002 | 7 | 657 | 650 (98.9%) | 878 | 877 (99.9%) | 7 / 7 | 6 / 7 (5) | 7 / 7 |
| job-015 | 37 | 1425 | 1420 (99.7%) | 3907 | 3905 (99.95%) | 37 / 37 | 35 / 37 (11) | 37 / 37 |
| job-004 | 18 | 212 | 210 (99.1%) | 1286 | 1279 (99.5%) | 15 / 18 | 16 / 18 (8) | 0 / 18 |
| job-005 | 35 | 331 | 326 (98.5%) | 808 | 808 (100%) | 35 / 35 | 35 / 35 (6) | 0 / 35 |
| job-008 | 16 | 179 | 172 (96.1%) | 762 | 762 (100%) | **0 / 16** | 12 / 16 (11) | 2 / 16 |
| job-013 | 23 | 199 | 197 (99.0%) | 948 | 945 (99.7%) | 22 / 23 | 18 / 23 (12) | 23 / 23 |

Unparsed tokens by pattern class (the class is the family, the number of dimensions and whether fractions or decimals are present; no strings):

| Doc | Unparsed profile-like classes | Unparsed dimension-like classes |
|---|---|---|
| job-002 | L with 2 dimensions: 7 | inches only: 1 |
| job-015 | L with 2 dimensions: 3; L with 3 dimensions and fractions: 2 | inches only: 2 |
| job-004 | PIPE with 1 dimension: 1; ROD in the suffix form: 1 | inches only: 7 |
| job-005 | L with 2 dimensions: 1; L with 3 dimensions and fractions: 2; PL with 3 dimensions and fractions: 1; ROD in the suffix form: 1 | none |
| job-008 | PL with 2 dimensions: 1; PL with 2 dimensions and fractions: 1; PL with 3 dimensions: 5 | none |
| job-013 | L with 2 dimensions: 1; ROD in the suffix form: 1 | inches only: 3 |

## What stands out (counts, no content)
- **Sheet number:** found on 116 of 136 pages. `job-008` finds none: no sheet-number-shaped word sits in the assumed title-block region (bottom-right corner or the far-right strip) on any of its 16 pages, although 12 of its pages have such a word elsewhere and 3 pages have a "sheet no" label line. So the title block of that document is laid out differently from what the Phase 2 rules assume. The pages stay `needs_review` with `sheet_number_not_found`; nothing is guessed. `job-004` finds 15 of 18 (the other 3 have several candidates of similar size, or none clearly larger).
- **Titles:** `job-004` and `job-005` find none on any page. Titles are only taken next to a "TITLE" label, which these documents do not seem to use in a form the rule accepts.
- **Scales:** at least one scale on 122 of 136 pages, but exactly one on only 53 of 136: most pages carry several different scales (several views), and those pages are `needs_review` with `multiple_scales`. Which scale belongs to which view is not attempted.
- **Profiles:** the unparsed ones are mostly angles written with two dimensions (no thickness), plates (`PL`) in forms the plate rule does not take (`job-008`), and rods or pipes in forms not covered (suffix-form rod, pipe without a size).
- **Dimensions:** the few unparsed ones are inch-only tokens.
- **Elevation notes** are parsed (datum always unknown) but were not part of this coverage count.

## Not measured
Correctness of any parsed value; how many profile or dimension strings are missed because they look different from the loose patterns; validation against a catalog (the owner's AISC file has not been supplied, so every profile is `unvalidated` here).
