# ProofLink Employee Compensation Foundation

This document is the implementation brief for ProofLink's first payroll-ready employee compensation layer.

## Why this exists

ProofLink already tracks team members, time entries, field assignments, and estimated payroll from simple hourly rates. This foundation upgrades that into a real compensation model that can:

- honor union contract minimums
- preserve employee-specific rates above scale
- support driver labeling differences without breaking the union floor
- stay usable for operators before full payroll exists
- grow into payroll exports later without rewriting the schema

## Current operating rule

For the first release, compensation is governed by the union agreement as the minimum source of truth. There are no business exceptions below scale. The main remaining flexibility is:

- employee-specific pay above scale
- driver labeling differences such as a driver being classified or displayed as `metal trades` or an insurance-driven alternate label

## Deliverables implemented in this batch

- `sql/employee_compensation_foundation.sql`
- `supabase/migrations/20260409110000_employee_compensation_foundation.sql`
- `netlify/functions/utils/compensation.js`
- `netlify/functions/get-team-hours.js`
- `netlify/functions/manage-labor-contracts.js`
- `netlify/functions/manage-member-compensation.js`
- direct unit coverage for compensation resolution and team-hours integration

## Recommended data model

The compensation system is split into five concerns.

### 1. Worker identity

Lives primarily on `operator_members`.

New worker-facing fields:

- `worker_label`
- `driver_label`
- `compensation_type`
- `is_union_member`
- `union_local_number`
- `union_classification_label`

These fields support quick operator visibility without replacing the source-of-truth assignment tables.

### 2. Contract floor

Union agreements are modeled in:

- `labor_contracts`
- `labor_contract_classifications`
- `labor_contract_rate_periods`

This creates a normalized contract structure with effective dating and classification-specific rate periods.

### 3. Configured compensation

Reusable company-level setups live in:

- `compensation_profiles`
- `compensation_profile_components`

Employee-specific active terms live in:

- `member_compensation_assignments`

This lets two workers share the same union floor while still carrying different configured actual pay.

### 4. Exceptions and temporary changes

Short-lived or employee-specific adjustments live in:

- `member_compensation_overrides`

This is where a worker can be paid above scale, temporarily relabeled, or given short-term premiums without corrupting the base assignment history.

### 5. Job costing and auditability

Job-specific minimum or premium context lives in:

- `job_labor_requirements`

Resolved outcomes and future payroll traces live in:

- `compensation_audit_log`

## Calculation precedence

The backend compensation resolver follows this order:

1. contract minimum floor
2. assignment-level configured pay
3. employee override
4. job-specific premium package
5. time-rule multipliers such as OT, DT, holiday, shift differential

In the current implementation, the live resolver is handling the first three layers for hourly resolution inside `get-team-hours`.

## Current backend resolution behavior

`netlify/functions/utils/compensation.js` now resolves:

- active assignment by effective date
- active override by effective date
- matching union classification
- matching rate period
- contract floor cents
- configured hourly cents
- final resolved hourly cents
- trace metadata explaining the source

If the compensation tables are not deployed yet, `get-team-hours` falls back cleanly to the legacy `operator_members.hourly_rate_cents` model instead of hard failing.

## Operator UX plan

Phase 1 operator questions:

- Who is this worker?
- What are they labeled as?
- What contract classification are they under?
- What is the union minimum?
- What is their configured actual rate?
- Why is their effective pay what it is?

Recommended first UI surfaces:

1. Team roster compensation card
2. Employee compensation detail drawer
3. Contract and classification rate card manager
4. Earnings preview panel for time and job costing

Phase 1 should avoid full payroll jargon and focus on:

- union floor
- actual configured pay
- override reason
- effective dates
- driver/worker labels

## Local 98 handling notes

This foundation is intentionally built around contract minimums because Local 98 style agreements operate as the floor, not necessarily the employee's final pay.

Important assumptions carried in this release:

- union agreement governs minimum compensation
- drivers may still be labeled differently from the standard trade classification
- those label differences should not silently lower the contract floor

The latest public contract evidence we found showed an older 2019-2025 agreement and a 2025 ratification notice, so the current signed agreement should still be uploaded and normalized before full payroll-grade automation is built.

## Current operator/admin surface

The current live management layer now includes:

- Team member union and driver labeling fields on `manage-operator-members`
- labor contract CRUD on `manage-labor-contracts`
- member assignment and override CRUD on `manage-member-compensation`
- Team hours reporting that shows effective rate, contract floor, and source trace

This means operators can now:

- store worker and driver labels
- mark union participation
- store local number and classification label
- create labor contracts and rate periods through API
- create member assignments and overrides through API
- see the contract-floor effect in hours reporting

## Smallest useful release

The smallest useful live release after this foundation is:

1. deploy the schema
2. add contract rows for the active union agreement
3. add assignment rows for each worker
4. expose effective pay and contract floor in Team
5. use the same resolver in job costing and time entry preview

That gives operators an immediately useful compensation system without pretending payroll is done.

## Next implementation batch

1. Add a full Team compensation drawer for assignment and override editing.
2. Reuse the resolver in time entry logging and job earnings preview.
3. Add compensation audit snapshots when time entries or payroll previews are generated.
4. Add seeded contract import helpers for uploaded wage sheets.
5. Expand the resolver for salary, day-rate, job-rate, commission, and premium components.
