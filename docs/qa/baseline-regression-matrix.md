# ProofLink Baseline Regression Matrix

This is the baseline regression order for roadmap work.

## Tier 1: Must stay green for all roadmap work

- `npm run test:unit`
- `npm run test:preflight:release-readiness`

## Tier 2: Required when touching these workflow families

### Onboarding and provisioning

- Public onboarding submit
- Admin approval and tenant provisioning
- Operator bootstrap after provisioning

Suggested checks:

- Unit coverage for touched onboarding and provisioning paths
- `npm run test:preflight:service-workflow` when service workflow schema or setup is involved

### Revenue paths

- Public checkout
- Billing portal
- Stripe webhook processing
- Subscription or billing state transitions

Suggested checks:

- Relevant unit tests
- Admin Stripe health validation

### Recurring workflows

- Recurring plan creation or update
- Daily recurring order generation
- Schema-readiness behavior for recurring tables or RPCs

Suggested checks:

- Targeted unit tests for create and process flows

### Operator high-friction flows

- Dashboard bootstrap
- Bookings
- Quotes and bids
- Customer follow-up
- Payments visibility

Suggested checks:

- Unit tests for touched workspace logic
- E2E or smoke coverage for browser-facing regressions when workflow behavior changes materially

### Admin operations

- Approval
- Provisioning visibility
- Tenant search
- Tester exemption
- Tenant messaging
- Password reset
- Platform health

Suggested checks:

- Direct unit coverage for touched admin helpers

## Tier 3: Manual checks until replaced by automation

- Admin login and load
- Operator login and bootstrap
- Public onboarding submit
- Public order or quote flow relevant to the release
- Billing portal or customer portal relevant to the release

## Regression notes

- If a workflow family depends on non-core tables or RPCs, missing schema must fail with a readiness signal, not a generic internal error.
- If a change touches auth, tenant isolation, payments, or provisioning, treat it as high risk even if the code diff is small.
