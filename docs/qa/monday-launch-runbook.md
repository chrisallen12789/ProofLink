# Monday Launch Runbook

Use this runbook before a real Monday rollout so the office is checking the same high-risk paths every time.

## Goal

Confirm that:

- operator launch controls are present
- Team rollout actions still work
- crew handoff still works
- role-based auth paths are healthy
- accessibility smoke is still clean
- the wider service workflow still completes end to end

## One-command gate

- `npm run test:launch-readiness`

This runs:

- `npm run test:preflight:release-readiness`
- `npm run test:e2e:monday-office`
- `npm run test:e2e:role-audit`
- `npm run test:e2e:a11y-smoke`
- `npm run test:e2e:service-workflow`

## Monday office dry run

Use the live operator app to walk this exact sequence:

1. Open `Team`
2. Confirm `Readiness summary`, `Monday launch checklist`, and `Monday rollout`
3. Open one employee `Profile`
4. Open `Training`
5. Use `Log training time`
6. Open `Records`
7. Open `Driver setup`
8. Open the crew handoff path from the office into `/crew/`

## Real-world go-live checklist

1. Invite each new worker from Team
2. Finish driver setup where needed
3. Mark training signoff items with real evidence
4. Confirm office records are on file
5. Export `Monday`, `Launch`, and `Audit` CSVs if the office wants a printed or shareable checkpoint
6. Assign one real or test job and confirm the crew app opens the packet

## If something fails

Treat it in this order:

1. `test:preflight:release-readiness` failure
2. `monday-office` failure
3. role audit failure
4. service workflow failure
5. accessibility smoke failure

That order keeps Monday-critical operator and crew use ahead of lower-risk polish.
