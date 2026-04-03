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
- `system-map.js`
  Tracks the shipped AI surface inventory: structured agent entry points, copilot specialist lanes, model-driven surfaces, and shared governance signals.
- `ai-agent-report.js`
  Operator-authenticated endpoint for listing agents and requesting a structured report.

## Agents

- `job_record_auditor`
  Reviews one job and its linked order, proof, payments, invoices, expenses, time segments, and compliance state to produce a billing-readiness report.
- `estimating_assistant`
  Separates known estimate facts from missing inputs from the Walkthrough Bids workflow. It never invents prices.
- `proposal_readiness_auditor`
  Reviews proposal defaults, signer readiness, validity timing, terms coverage, and deposit setup before a walkthrough bid is sent or converted.
- `quote_rescue_manager`
  Builds a grounded rescue queue for live quotes and walkthrough proposals so operators can separate follow-up-ready work from estimate cleanup and stale records that should be reworked first.
- `service_plan_renewal_manager`
  Builds a grounded renewal queue for recurring service plans so next-run timing, missing cadence, and overdue repeat-service accounts stay visible before they drift.
- `retention_reactivation_manager`
  Builds a grounded customer reactivation queue so quiet repeat-service accounts, open-work holds, and plan overlap stay inspectable before outreach starts.
- `dispatch_scheduling_assistant`
  Reviews upcoming jobs for missing dates, missing assignments, missing times, same-slot conflicts, and same-day bundling opportunities.
- `billing_blocker_detector`
  Builds a queue of jobs that still need billing cleanup.
- `collections_followup_assistant`
  Separates true overdue balances from general open balances so follow-up stays accurate.
- `field_closeout_coach`
  Reviews the field handoff package so proof, timing, and closeout gaps are caught before billing cleanup starts downstream.
- `site_packet_builder`
  Builds a grounded site packet from customer, site, and prior-work context so crews arrive with better operational memory.
- `import_migration_assistant`
  Reviews legacy CSV headers and sample rows, explains what ProofLink can route safely, and suggests a reusable import profile before the operator imports anything.
- `accounting_continuity_auditor`
  Checks that outside-accounting references stay traceable across orders, jobs, invoices, payments, and import learning.
- `agent_workforce_architect`
  Reviews live tenant workload, import-learning history, service-plan pressure, and recent agent usage to identify the next specialist agents ProofLink should add and the current lanes that need sharper training.
- `ai_systems_architect`
  Reviews the shipped AI stack itself so ProofLink can expose hidden lanes, promote freeform-only specialists into structured reports, and harden shared AI files in the right order.

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
npx vitest run tests/unit/netlify/functions/agent-schemas.test.js tests/unit/netlify/functions/job-record-auditor.test.js tests/unit/netlify/functions/agent-workforce-architect.test.js tests/unit/netlify/functions/ai-systems-architect.test.js tests/unit/netlify/functions/ai-agent-report.test.js tests/unit/admin-ai-control.test.js tests/unit/operator/jobs-workspace.test.js tests/unit/operator/command-center.test.js
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
- Walkthrough Bids workspace
  Use `Run proposal readiness review` for the active bid before send or convert so branding defaults, signer setup, validity timing, terms, exclusions, and deposit expectations stay inspectable.
- Walkthrough Bids workspace
  Use `Run estimate review` for the active bid and `Run quote rescue review` for the proposal queue so estimate gaps and follow-up timing stay grounded in real proposal records.
- Dispatch workspace
  Use `Run dispatch review` in the `AI dispatch review` card to review the selected hydrovac day for missing assignments, overlap conflicts, untimed work, and bundling opportunities.
- Payments workspace
  Use `Run collections review` to separate genuinely overdue balances from general open balances, then work directly into `Record payment`, `Open order`, or `Open customer`.
- Jobs workspace
  Use `Run closeout review` and `Run site packet review` to tighten field handoff quality and crew prep from the job detail surface.
- Orders workspace
  Use the accounting continuity review to keep outside-accounting references visible through billing follow-through.
- Recurring Plans workspace
  Use `Run renewal review` in plan detail to separate due-soon plans, plans missing the next run, and accounts that already need schedule recovery.
- Customers workspace
  Use `Run reactivation review` in customer detail to separate immediate reactivation candidates, open-work holds, plan overlap, and lighter-touch follow-up accounts.
- Import workspace
  Use `Run AI migration review` after previewing a CSV to see grounded mapping coverage, row-routing risk, and the learned import profile ProofLink can save for future legacy exports.

The retention training loop is intentionally tied to the shipped customer workbench:

- `operator/operator-customer-detail.js` exposes repeat-service memory such as cadence notes, checklist memory, equipment follow-up, and post-work recovery cues.
- `netlify/functions/agent/tools.js`
  Loads those same customer-memory fields into the retention context so the reactivation lane is trained on the operator workflow that actually shipped.
- `retention_reactivation_manager`
  Uses those saved customer-memory fields as grounded repeat-service signals before ranking dormant accounts for follow-up.
- `tests/unit/netlify/functions/retention-reactivation-manager.test.js`
  Protects that training path so new customer-memory fields stay connected to the backend lane instead of drifting into UI-only logic.

## Admin Usage

- Admin panel
  Use `Run workforce review` in `Internal AI Control` to see which specialist agents should be added or trained next for the selected tenant.
- Admin panel
  Use `Run systems review` in `Internal AI Control` to inspect AI architecture gaps, hidden lanes, freeform-only specialists, and shared AI file hardening targets for the selected tenant.

## Import Profiles

- `netlify/functions/manage-import-profiles.js`
  Tenant-admin endpoint for loading and saving reusable import profiles in `tenant_config`.
- `operator/components/import-tools.js`
  Shared profile-aware import helpers for header detection, alias resolution, and profile matching.
- `operator/import-workspace.js`
  Applies saved profiles during preview and lets operators save the learned profile from the AI migration review.

The import profile loop is intentionally narrow:

- Profiles are scoped to the tenant.
- They store header aliases plus short walkthrough guidance from prior operator corrections.
- Saving a profile is an explicit operator action.
- The migration assistant never writes records or profiles automatically.

## Guided Import Learning

- `operator/import-workspace.js`
  Adds a source-aware walkthrough that explains the next best migration step, flags risky rows, lets operators reconcile fields inline before import, and keeps post-import cleanup visible for attachment carry-forward and unresolved links.
- `manage-import-profiles.js`
  Persists learned import notes, corrected field hotspots, and a walkthrough summary alongside the reusable profile.
- `import_migration_assistant`
  Reads that tenant-scoped guidance back during later reviews so the import agent gets more grounded over time without any uncontrolled model fine-tuning, including attachment-heavy files and merge-target risk.

This is the current "training" loop for the migration agents:

- source presets improve first-pass detection
- saved profiles improve column matching
- operator walkthrough edits improve future coaching
- explicit merge choices improve future caution around ambiguous customer or work matches
- cleanup-inbox patterns improve how the migration agent warns about attachment follow-up and orphaned records
- all learning stays tenant-scoped and inspectable

## Workforce Review Loop

- `netlify/functions/agent/agents/agent-workforce-architect.js`
  A deterministic meta-agent that looks for grounded AI-system gaps instead of chatting about them.
- `netlify/functions/agent/tools.js`
  Builds the workforce context from tenant profile, business workload, service-plan pressure, import profiles, and recent `agent_audit_events`.
- `admin/admin.js`
  Adds the admin-only workforce review control and renders the report for the selected tenant.
- `admin/index.html`
  Hosts the `Internal AI Control` section so the internal agent layer stays separate from operator-facing workflow reviews.

The workforce architect is intentionally narrow:

- it does not create agents automatically
- it does not train models automatically
- it only recommends additions or training targets when the tenant data actually shows pressure
- it points back to the affected workspace or records so the recommendation stays inspectable

Operator-facing workflow delivery is part of the internal AI training loop too:

- `tests/e2e/internal-ai-boundary-workflow.spec.js`
  Exercises the real operator/admin UI contract so workflow reviews stay operator-facing while the agent-system layer stays admin-only.
- `tests/e2e/owner-trust-smoke.spec.js`
  Protects the calm launch/onboarding entry flow that feeds the first operator setup experience.
- UI repair work should update these workflow smokes when a new agent report, workspace entry point, or admin-only control is introduced.
- This is still deterministic product hardening, not model fine-tuning.

Current pressure patterns it watches for:

- renewal, closeout, dispatch, collections, and continuity lanes that need sharper grounding from live tenant usage
- recurring correction hotspots that should sharpen the import, collections, and dispatch assistants
- adoption gaps where shipped lanes are still underused

## Systems Review Loop

- `netlify/functions/agent/agents/ai-systems-architect.js`
  A deterministic AI systems specialist that reviews what ProofLink has already shipped across structured agents, freeform copilot lanes, and model-driven AI files.
- `netlify/functions/agent/system-map.js`
  Keeps the AI surface inventory explicit so system recommendations stay inspectable instead of relying on hidden assumptions.
- `admin/admin.js`
  Runs the admin-only systems review and renders the findings, blockers, and recommended actions beside the workforce review.

The systems architect is intentionally narrow:

- it does not rewrite prompts, files, or registry entries automatically
- it does not recommend new lanes without tying them to a shipped AI surface gap or real tenant pressure
- it can recommend AI file hardening, but execution still stays manual and inspectable
- it is admin-only because operators should see workflow help, not the internal AI strategy layer

Current gap patterns it watches for:

- shared model policy that should be centralized across the model-driven AI surfaces
- admin/operator surface drift where the shipped AI inventory no longer matches the actual workflow entry points
- low AI telemetry that means the next expansion wave should still follow real operator usage
