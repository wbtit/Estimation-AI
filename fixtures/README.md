# Fixtures Directory

This directory is reserved for test and development fixtures (such as sample drawings or test inputs).

## Confidentiality and Data Handling Rules
1. **Never commit client drawings or proprietary project data.**
2. Real drawing PDFs must not be tracked in version control (enforced via `.gitignore`: `fixtures/*.pdf`).
3. Fixture data and synthetic test samples must always use strictly anonymized identifiers (e.g. `job-001`, `project-001`).
4. Never include real client names, project names, or proprietary metadata anywhere in files, test suites, or fixtures.

## fixtures/synthetic
Made-up data used by the automated tests and the demo seed (`make seed-synthetic`): `TEST-001..003` shapes with obviously fake round weights and 14 synthetic members. It is not real steel data and must never be used as a catalog or as ground truth.
