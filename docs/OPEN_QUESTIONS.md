# Open questions

Each item is an assumption I made so Phase 1 could proceed while you were away. None blocks the work. Each says what I did and what to tell me if you want it different.

## Phase 1

1. **Pricing removed from Phase 1.** SPEC section 9 includes a pricing stub in Phase 1; the instruction for this run excluded pricing. I followed the instruction. Confirm that the pricing engine moves to a later phase, and which one.
2. **AISC file layout is unknown.** The catalog loader takes the name column, weight column and weight unit as explicit arguments instead of guessing header names. When you supply the file, tell me its headers (or let me read it) and I can add defaults. The weight unit has no default on purpose.
3. **Weight conversion.** If the file gives lb/ft, `weight_kg_per_m` is stored as lb/ft x (0.45359237 / 0.3048), the exact definitional conversion. Confirm you want kg/m as the stored weight and not an AISC metric column.
4. **Column supports.** SPEC says a member with no support is flagged, and `supported_by` lists member ids. Columns normally bear on foundations, not on other members. Default: columns are exempt from the "unsupported" flag (their `supported_by` references are still checked). Everything else needs at least one valid reference. Tell me if columns should also be flagged, or if a "foundation" marker should exist.
5. **Severity mapping.** red = the member cannot be weighed or its geometry is wrong (profile missing or not in catalog, non-positive weight or length, missing elevation, length unavailable). amber = the weight can be computed but the record is incomplete or suspect (material or grade missing, unsupported, bad support reference, duplicate). The worst issue sets the member status. Confirm or give me your mapping.
6. **Profile matching is exact.** The validator checks `member.profile` against catalog names with exact string equality. Turning `profile_raw` (for example "W18x35") into a catalog name is the job of extraction (Phase 2 to 4), not the validator, so nothing is silently normalized here.
7. **Duplicate rule.** Same type, same profile and the same two resolved end points (either direction, exact numeric equality, no tolerance). Every member in a duplicate group is flagged, and none is dropped. Members with no profile or no resolved end points are not compared.
8. **Length source.** Length is the 3D distance between `resolved_xyz_mm` of the two ends. If either is missing the length is "unavailable" (flagged red), not estimated from grids.
9. **Not implemented because they need your input:** material/grade plausibility per shape family (SPEC section 6) and the scale-based length sanity check. Tell me the plausibility table and I will add the rule.
10. **Rejected members.** Review status `rejected` cannot occur until Phase 3. For now every member returned by the project is included in the BOM. Decide in Phase 3 whether rejected members are excluded.
11. **Contract details I had to choose** (SPEC section 5 leaves them open). Confirm or correct:
    - `bbox` is `{x0, y0, x1, y1}` in page coordinates; the coordinate system is defined in Phase 4a.
    - Project `grids[].axis` is `'x'` or `'y'`; `unit_system` is the literal `'mm'` (pending the section 12 question).
    - `review` is `{ status, edits: [{ field, original_value, corrected_value, reviewer, timestamp }] }`; in Phase 1 `edits` is always empty.
    - Every key is required, and unknown values are explicit `null` (so a missing material cannot be mistaken for "not provided").
12. **Excel units.** Lengths are shown in mm and feet-inches (nearest 1/16 inch); weights in kg and lb, plus metric tonnes in the Summary. No short/long "tons" are used because the word is ambiguous. Tell me if you want different columns or units.
13. **Included-but-flagged members.** A member that can be weighed counts toward the totals even if it is amber or red for another reason (for example a missing end elevation), and its status is shown on its BOM line. Tell me if red members should be excluded from totals instead.

