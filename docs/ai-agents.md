# ProofLink AI Agents

ProofLink now has a structured agent layer under `netlify/functions/agent`.

## Architecture

- `registry.js`
  Declares each operational agent, its purpose, inputs, allowed tools, forbidden behaviors, confidence guidance, and execution handler.
- `runtime.js`
  Runs an agent report with policy checks, schema validation, and audit logging.
- `schemas.js`
  Validates the structured report contract:
  `summary`, `findings`, `blockers`, `evidence`, `assumptions`, `missing_data`, `confidence`, `recommended_actions`.
- `evidence.js`
  Builds stable evidence references so every recommendation can point back to real records.
- `tools.js`
  Holds read-only data loaders scoped to a verified tenant.
- `ai-agent-report.js`
  Operator-authenticated endpoint for listing agents and requesting a structured report.

## Agents

- `job_record_auditor`
  Reviews one job and its linked order, proof, payments, invoices, expenses, time segments, and compliance state to produce a billing-readiness report.
- `estimating_assistant`
  Separates known estimate facts from missing inputs. It never invents prices.
- `dispatch_scheduling_assistant`
  Reviews upcoming jobs for missing dates, missing assignments, missing times, same-slot conflicts, and same-day bundling opportunities.
- `billing_blocker_detector`
  Builds a queue of jobs that still need billing cleanup.
- `collections_followup_assistant`
  Separates true overdue balances from general open balances so follow-up stays accurate.
- `import_migration_assistant`
  Reviews legacy CSV headers and sample rows, explains what ProofLink can route safely, and suggests a reusable import profile before the operator imports anything.

## Safety Boundaries

- All agent tools are read-only.
- Every run requires operator auth and is scoped to `tenant_id`.
- Agent output is schema-validated before it is returned.
- Every report includes evidence references and record references.
- Recommendations are advisory only. No agent performs write actions.
- Unknown or missing data must be called out explicitly in `missing_data` or `assumptions`.

## Job Record Auditor

The first full vertical slice is the Job Record Auditor.

Operator entry point:
- `operator/operator-jobs-workspace.js`

Backend report path:
- `netlify/functions/ai-agent-report.js`
- `netlify/functions/agent/agents/job-record-auditor.js`

It checks:
- linked order and customer presence
- service address
- actual start/end timing
- closeout note presence
- proof photos
- signature presence
- invoice state
- payment state contradictions
- open time segments
- hydrovac manifest and compliance blockers when present

## Local Testing

Run the targeted unit tests:

```bash
npx vitest run tests/unit/netlify/functions/agent-schemas.test.js tests/unit/netlify/functions/job-record-auditor.test.js tests/unit/netlify/functions/ai-agent-report.test.js tests/unit/operator/jobs-workspace.test.js
```

For a broader pass:

```bash
npm run test:unit
```

## Operator Usage

1. Open the Jobs workspace.
2. Select a job.
3. In job detail, use `Run billing audit`.
4. Review the returned facts, blockers, evidence, and recommended actions.

The audit is advisory. Operators still decide whether to update records, create invoices, or send follow-ups.

## Operator Queues

- Money workspace
  Use `Run blocker review` in the `Billing blocker queue` card to build a job queue of invoice blockers with direct `Open job` actions.
- Dispatch workspace
  Use `Run dispatch review` in the `AI dispatch review` card to review the selected hydrovac day for missing assignments, overlap conflicts, untimed work, and bundling opportunities.
- Payments workspace
  Use `Run collections review` to separate genuinely overdue balances from general open balances, then work directly into `Record payment`, `Open order`, or `Open customer`.
- Import workspace
  Use `Run AI migration review` after previewing a CSV to see grounded mapping coverage, row-routing risk, and the learned import profile ProofLink can save for future legacy exports.

## Import Profiles

- `netlify/functions/manage-import-profiles.js`
  Tenant-admin endpoint for loading and saving reusable import profiles in `tenant_config`.
- `operator/components/import-tools.js`
  Shared profile-aware import helpers for header detection, alias resolution, and profile matching.
- `operator/import-workspace.js`
  Applies saved profiles during preview and lets operators save the learned profile from the AI migration review.

The import profile loop is intentionally narrow:

- Profiles are scoped to the tenant.
- They store header aliases only, not imported row values.
- Saving a profile is an explicit operator action.
- The migration assistant never writes records or profiles automatically.
