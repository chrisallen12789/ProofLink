# ProofLink test foundation

1. Use either a local Supabase instance or a hosted Supabase project that already has [sql/CATCHUP_RUN_THIS.sql](/C:/Users/Chris/ProofLink/sql/CATCHUP_RUN_THIS.sql) applied.
2. Create `.env.test` from `.env.test.example`.
3. Set `TEST_SUPABASE_URL`, `TEST_SUPABASE_SERVICE_ROLE_KEY`, and `TEST_SUPABASE_ANON_KEY` to the target project you want the tests to use.
4. Run `npm run test:cleanup`.
5. Run `npm run test:seed`.
6. Run `npm run test:unit`.
7. Run `npm run test:integration`.
8. Run `npx playwright install chromium`.
9. Start Netlify dev against the same environment.
10. Run `npm run test:e2e`.

Notes:
- All deterministic test data uses the `pltest-` prefix.
- Cleanup only removes `pltest-` rows whose slugs/emails still match the seeded test prefix guard.
- The seed and cleanup scripts now work against hosted Supabase as long as `.env.test` points at that project.
- Do not point `.env.test` at a production project unless you are comfortable with `pltest-` prefixed test data being created and deleted there.

## GitHub Actions

The default CI workflow lives at [`.github/workflows/test.yml`](/C:/Users/Chris/ProofLink/.github/workflows/test.yml).

- The `unit` job always runs.
- The `hosted-integration` job runs `cleanup -> seed -> integration` against the hosted Supabase project.
- On pushes, manual runs, and pull requests from this repository, missing hosted test secrets fail the workflow immediately with a clear error.
- On pull requests from forks, the hosted suite is skipped because GitHub does not expose repository secrets to untrusted forks.

Required GitHub Actions secrets for the hosted suite:

- `TEST_SUPABASE_URL`
- `TEST_SUPABASE_SERVICE_ROLE_KEY`
- `TEST_SUPABASE_ANON_KEY`
- `TEST_SITE_URL`
- `TEST_PLATFORM_ADMIN_EMAIL`
- `TEST_PLATFORM_ADMIN_PASSWORD`
- `TEST_TENANT_A_ADMIN_EMAIL`
- `TEST_TENANT_A_ADMIN_PASSWORD`
- `TEST_TENANT_B_ADMIN_EMAIL`
- `TEST_TENANT_B_ADMIN_PASSWORD`

Before enabling the hosted suite on a new project, apply [sql/catchup_run_this.sql](/C:/Users/Chris/ProofLink/sql/catchup_run_this.sql) to that Supabase database first.
