# Role-based user audit

ProofLink already had unit, integration, and workflow e2e coverage. This audit lane adds the missing question:

"What breaks when a real person signs in as each class of user and clicks through the product?"

## What this lane covers

- Public visitor
- Platform admin
- Tenant owner/operator
- Tenant staff member
- Crew/field user

For each role, the browser audit now checks:

- uncaught page errors
- console errors
- failed network requests
- key page loads and interaction points

The accessibility smoke lane runs Axe against:

- landing page
- join page
- admin overview
- operator dashboard
- crew home

## Commands

- `npm run test:seed`
- `npm run test:e2e:role-audit`
- `npm run test:e2e:a11y-smoke`
- `npm run test:e2e:user-classes`

## Recommended operating loop

1. `npm run test:cleanup`
2. `npm run test:seed`
3. `npm run dev:test`
4. `npm run test:e2e:user-classes`
5. Fix failures before shipping

## What to expect

This lane is meant to catch:

- broken buttons
- empty or dead-end workflows
- JS errors that do not show up in unit tests
- role-specific auth regressions
- weak or missing accessibility wiring
- browser-only failures after refactors

## Current limitations

- The accessibility smoke disables `color-contrast` for now so the lane can land without blocking on visual token cleanup.
- The audit is intentionally smoke-level. It complements, but does not replace, the deeper workflow specs.
- If you want stronger coverage for a single role, add a dedicated spec beside the audit rather than bloating the smoke lane.
