# ProofLink Next-Steps Checklist

If you're unsure what to do next, follow this order.

## Team recommendation (start here)

If the team had to pick one direction right now, it would likely be:

1. **Stability first:** run baseline checks and fix failures before adding features.
2. **Protect revenue paths:** validate onboarding, provisioning, checkout, and Stripe webhook idempotency.
3. **Then ship one focused improvement** in either reliability, security, or operator UX.

This sequence reduces production risk while still moving the product forward.

## 1) Validate local setup

- Copy `.env.example` to `.env` and populate required keys.
- (Optional for integration tests) Copy `.env.test.example` to `.env.test`.
- Install dependencies:

```bash
npm install
```

## 2) Run baseline quality checks

```bash
npm run test:unit
npm run test:preflight:service-workflow
```

If these fail, fix the first failing area before starting new work.

## 3) Validate critical business flows (in this order)

1. Onboarding submit (`/join` + `netlify/functions/onboarding.js`)
2. Admin approval + tenant provisioning (`/admin` + `admin-approve-onboarding.js`)
3. Operator bootstrap (`get-operator-setup.js`)
4. Public order checkout (`order.js` + Stripe functions)
5. Stripe webhook processing (`stripe-webhook.js`, `stripe-billing-webhook.js`)

## 4) Safety checks for any backend change

For each endpoint you touch, confirm:

- It responds with `respond()` from `netlify/functions/utils/auth.js`
- Operator/admin routes use required auth context helpers
- Queries are tenant-scoped via `tenant_id`
- No frontend direct DB writes were introduced

## 5) Pick exactly one lane for this sprint

- **Reliability lane (recommended):** Add/extend tests for onboarding + webhook idempotency
- **Security lane:** Audit one function group for missing auth or tenant scoping
- **Product lane:** Improve one operator tab UX and wire matching function updates
- **Ops lane:** Improve runbook/docs for Stripe/Resend/Turnstile setup and troubleshooting

## 6) Definition of done

- Relevant tests pass
- No secrets committed
- No RLS weakening
- No frontend framework/build step introduced
- Function auth + tenant isolation patterns remain consistent

---

## Immediate next 3 commands

1. `npm run test:unit`
2. `npm run test:preflight:service-workflow`
3. `npm run test:integration:service-workflow`
