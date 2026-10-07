# Phase 1 plan: contract, catalog, validator, BOM, Excel

Branch `phase-1` (from `phase-0`). Scope is exactly what was requested; anything outside it is listed under "Not in this phase".
Conflicts with SPEC or CLAUDE.md: none that block. One deliberate narrowing (pricing) is recorded below. Assumptions I had to make are in `docs/OPEN_QUESTIONS.md` with the default I chose.

## Deliverables
1. **Member data contract, schema_version 0** (`api/src/contract/`)
   - Zod schemas for project, sheet, member (nested shape from SPEC section 5) and a top-level contract document. TypeScript types are inferred from them.
   - JSON Schema generated from the same Zod schemas into `schema/contract.v0.schema.json`; a test fails if the committed file drifts from the code.
   - Objects are strict (unknown keys rejected). Grid labels are plain strings, never trimmed or normalized (Cyrillic look-alikes survive exactly).
2. **Units** (`api/src/units/`): mm is canonical. Feet-inches display formatter (nearest 1/16", carries correctly), exact conversion constants (1 in = 25.4 mm, 1 lb = 0.45359237 kg).
3. **Catalog loader** (`api/src/catalog/`)
   - Reads CSV or XLSX from a path. The column names and the weight unit (`lb/ft` or `kg/m`) are passed explicitly; there are no defaults, because the real file's layout is not known yet.
   - Enforces weight > 0 and unique names; collects every bad row with its row number and rejects the whole file if any row is bad (no partial imports).
   - Writes to `catalog_shapes` under an edition label. Editions are immutable: importing into an existing edition is refused.
   - CLI: `npm run catalog:import -- --file ... --edition ... --name-col ... --weight-col ... --weight-unit ...`.
4. **Validator** (`api/src/validator/`): pure, deterministic, never changes input. Rules:
   missing material, missing grade, missing profile, profile not in catalog, non-positive weight, missing start or end elevation (0 is valid), length unavailable, non-positive length, unsupported member, support reference not found, duplicate member. Non-Latin grid labels are allowed.
5. **BOM generator** (`api/src/bom/`): length from the resolved 3D end points (sloped members handled), weight from catalog weight per metre, times quantity. Computed on demand and never stored. Members that cannot be weighed stay listed and flagged and are excluded from totals; the exclusion is reported, not hidden.
6. **Excel export** (`api/src/excel/`): xlsx with a `BOM` sheet (one row per member) and a `Summary` sheet (totals, by profile, by type, status counts, issue counts, inputs used, a note that pricing is not included).
7. **API** (`api/src/routes/bom.ts`)
   - `GET /api/projects/:projectId/bom?edition=<label>` returns validation results plus the BOM as JSON.
   - `GET /api/projects/:projectId/bom.xlsx?edition=<label>` returns the workbook.
8. **Synthetic fixtures** (`fixtures/synthetic/`): `TEST-xxx` shapes with obviously fake round weights, and about 12 synthetic members covering each rule. A seed script loads them for the demo.
9. **Tests** for each of the above, all run against the real compose Postgres where the DB is involved.

## Not in this phase (by instruction or by SPEC dependencies)
- **Pricing.** SPEC section 9 lists a pricing stub in Phase 1; the instruction for this run says pricing is NOT in this phase, so there is no rate-table logic, no cost column and no price in the Excel. `rate_table` stays an empty table.
- Applying `member_edits` to values (the edit vocabulary is defined with the review UI in Phase 3). The endpoint uses member columns as stored.
- Material/grade plausibility per shape family (needs a table from you) and scale-based unit sanity (needs sheet scale from Phase 2).
- Any real AISC data. No catalog weights are invented; only `TEST-xxx` rows in test fixtures.

## Order of work
contract and units, then catalog loader, validator, BOM, Excel, API and seed; lint and the full test run after each stage; Decision Log; commit on `phase-1` (hook must pass; no push).
