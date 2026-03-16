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
