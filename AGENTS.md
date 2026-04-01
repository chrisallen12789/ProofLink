# AGENTS.md — ProofLink contributor playbook

This file gives human and AI contributors a fast, predictable workflow for shipping changes in this repo.

Scope: entire repository (unless a deeper `AGENTS.md` overrides).

---

## 1) Golden workflow (fast path)

1. **Read this file first** and then scan `package.json` scripts.
2. Make the smallest change that satisfies the task.
3. Run targeted checks first, then broader checks:
   - `npm run -s test:preflight:env-contract`
   - `npm run -s test:unit -- <target test file(s)>`
   - `npm run -s test:unit` (if behavior changed beyond one file)
4. If changing integration behavior, run:
   - `npm run -s test:preflight:env-runtime`
   - `npm run -s test:integration` (only with real hosted `TEST_*` values)
5. Commit with a specific message and include exact commands run in the final summary.

---

## 2) High-signal commands

- **Lint**
  - `npm run lint`
- **Unit tests**
  - `npm run test:unit`
  - `npm run test:unit -- tests/unit/path/to/file.test.js`
- **Coverage gate**
  - `npm run test:unit:coverage`
- **Hosted env validation**
  - `npm run test:preflight:env-contract` (docs/examples vs required keys)
  - `npm run test:preflight:env-runtime` (actual `.env.test` readiness)
- **Integration**
  - `npm run test:integration`
  - `npm run test:integration:service-workflow`
- **Seed/cleanup**
  - `npm run test:cleanup`
  - `npm run test:seed`

---

## 3) Common failure pattern (most important)

If integration tests explode with:
- `fetch failed`
- `ENOTFOUND your-project.supabase.co`
- or many null/auth follow-on errors

then `.env.test` is still missing or using placeholder values.

Fix order:
1. Copy `.env.test.example` → `.env.test`
2. Replace all placeholders with real hosted test values
3. Run `npm run test:preflight:env-runtime`
4. Re-run integration tests

---

## 4) Definition of done (DoD)

For non-trivial code changes:

- [ ] Change is minimal and scoped to request
- [ ] Existing behavior remains backward compatible unless explicitly requested
- [ ] Tests updated/added for new behavior
- [ ] Relevant scripts/checks executed and recorded
- [ ] Docs updated if command flow or env expectations changed

---

## 5) Code style and change strategy

- Prefer small, composable helpers over large inline logic.
- Keep error messages actionable (include remediation steps).
- For env validation, fail fast and clearly.
- Don’t add broad refactors unless requested.
- Keep mock/test fixtures deterministic (`pltest-` conventions).

---

## 6) PR summary template

Use this structure in final summaries:

1. **What changed** (bullets by area/file)
2. **Why** (user-visible impact / risk reduced)
3. **Validation** (exact commands + pass/fail/warn)
4. **Follow-ups** (only if truly needed)

