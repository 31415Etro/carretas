# Operational Test Results

Date: 2026-09-09
Target: local application at http://localhost:3003, connected Supabase database.
Scope: PMOC, service orders, clients, environments, equipment and stock labels.

## Passed

- 44 automated tests: all repository unit tests plus page-handler regression tests.
- 37 HTTP checks using a real, temporary authenticated test account.
- Anonymous access restrictions and client-role write restrictions.
- Authenticated HTML responses for PMOC, clients/environments, stock and service orders.
- All three state sections load successfully, each below 4 MB.
- All 1,356 equipment records load; all 760 stock labels have unique point IDs.
- Client/environment/equipment creation, equipment editing and relationship validation.
- PMOC plan, equipment, service, order and schedule persistence; identical retry without duplication.
- Client-scoped PMOC reads exclude other clients.
- New budget points create labels; production, ready and used status transitions persist.
- Manual used status survives reload; reopening clears used time and nullable checkboxes.
- Monthly boundaries, leap year, frequency validation and contract dates.
- Equipment grouping into one competency order, duplicate prevention and future-period isolation.
- Failed persistence does not display the generation-success notification.
- Label HTML: 760 labels in 190 A4 sheets, HTML escaping, empty selection and blocked popup handling.

Temporary records and the test authentication account were removed after the HTTP tests.
The initial stock test fixture omitted required budget fields; it was corrected before the final passing run.

## Not Passed Or Not Verified

- Full TypeScript check: failed with 244 diagnostics, including existing duplicate files and modules outside this scope. See `tmp/typecheck-operational-tests.log`.
- Browser clicks, client-side hydration, responsive layout and physical print preview: not verified because no browser was connected. HTTP HTML and extracted page-handler tests do not replace these checks.
- Production deployment: not performed. HTTP tests exercised the local version, not the published site.
- External paid services, financial operations and real customer communications were not exercised.

## Reproduction

- `node scripts/test-operational-http.cjs`: real HTTP integration checks; creates and removes isolated test fixtures. Requires local server and `.env.local`.
- `node scripts/verify-operational-flows.cjs --live`: database route integration checks; creates and removes temporary records.
- Unit test output: `tmp/operational-unit-results.log`.
- Production compilation passed in the preceding implementation run. Only tests and this report were added in the current validation run.
