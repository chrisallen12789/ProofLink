# ProofLink test foundation

1. Use either a local Supabase instance or a hosted Supabase project that already has [sql/catchup_run_this.sql](/C:/Users/Chris/ProofLink/sql/catchup_run_this.sql) applied.
2. Apply [sql/service_workflow_phase1.sql](/C:/Users/Chris/ProofLink/sql/service_workflow_phase1.sql) before running the service-workflow validation suite.
3. Create `.env.test` from `.env.test.example`.
4. Set `TEST_SUPABASE_URL`, `TEST_SUPABASE_SERVICE_ROLE_KEY`, and `TEST_SUPABASE_ANON_KEY` to the target project you want the tests to use.
5. Run `npm run test:cleanup`.
6. Run `npm run test:seed`.
7. Run `npm run test:preflight:service-workflow`.
8. Run `npm run test:unit`.
9. Run `npm run test:integration:service-workflow`.
10. Run `npx playwright install chromium`.
11. Start Netlify dev against the same environment.
12. Run `npm run test:e2e:service-workflow`.

Notes:
- All deterministic test data uses the `pltest-` prefix.
- Cleanup only removes `pltest-` rows whose slugs/emails still match the seeded test prefix guard.
- The seed and cleanup scripts now work against hosted Supabase as long as `.env.test` points at that project.
- Do not point `.env.test` at a production project unless you are comfortable with `pltest-` prefixed test data being created and deleted there.

## GitHub Actions

The default CI workflow lives at [`.github/workflows/test.yml`](/C:/Users/Chris/ProofLink/.github/workflows/test.yml).

- The `unit` job always runs, and it shares the same `TEST_*` secrets as the hosted suite because some unit tests load the common test environment bootstrap.
- The `hosted-integration` job runs `cleanup -> seed -> preflight -> integration` against the hosted Supabase project.
- On pushes, manual runs, and pull requests from this repository, missing hosted test secrets fail the workflow immediately with a clear error.
- On pull requests from forks, the hosted suite is skipped because GitHub does not expose repository secrets to untrusted forks.

Required GitHub Actions secrets for the workflow:

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

Before enabling the hosted suite on a new project, apply [sql/catchup_run_this.sql](/C:/Users/Chris/ProofLink/sql/catchup_run_this.sql) and then [sql/service_workflow_phase1.sql](/C:/Users/Chris/ProofLink/sql/service_workflow_phase1.sql) to that Supabase database first, then make sure `npm run test:preflight:service-workflow` passes against that same project.
