# AGENTS.md — test harness notes

Scope: `tests/` subtree.

## Purpose
Keep local + CI test runs fast, deterministic, and easy to debug.

## Order of operations
1. `npm run -s test:preflight:env-contract`
2. `npm run -s test:unit -- <target file>`
3. `npm run -s test:unit`
4. For hosted integration:
   - `npm run -s test:preflight:env-runtime`
   - `npm run -s test:cleanup`
   - `npm run -s test:seed`
   - `npm run -s test:integration`

## Debug heuristics
- If you see `ENOTFOUND your-project.supabase.co`, stop and fix `.env.test`.
- If tests fail with missing `TEST_*`, run `test:preflight:env-runtime` first.
- If seeded data assertions fail, re-run cleanup + seed before re-testing.

## Authoring expectations
- Prefer adding targeted unit tests before integration tests.
- Keep test names explicit about auth/tenant context.
- For integration tests, fail early on env requirements and avoid hidden retries.

