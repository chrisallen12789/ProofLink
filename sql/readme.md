# ProofLink SQL Reference

## Active files

### `CATCHUP_RUN_THIS.sql`
This is the versioned source of truth for the core live app schema that currently exists in the repo. It is intended to be runnable on a fresh Supabase project for the main ProofLink tables, views, RLS policies, and core RPCs.

It now includes:
- `tenant_onboarding_requests`
- `tenants`
- `plan_limits`
- `operators`
- `operator_members`
- `tenant_config`
- `tenant_settings`
- `products`
- `pricing`
- `availability`
- `expenses`
- `customers`
- `orders`
- `payments`
- `customer_interactions`
- `tenant_conduct_log`
- `pl_reserved_slugs`
- `pl_banned_keywords`
- `pl_protected_brands`
- `pl_prohibited_categories`
- `profiles`
- `onboarding_requests` view
- `operator_tenants` view
- `operator_member_access()` and `operator_member_tenant_access()`
- `submit_storefront_order()`
- `get_public_catalog_by_tenant()`
- `resolve_tenant_row()`
- `get_tenant_plan_limits(uuid)`
- `get_tenant_plan_limits(text)`
- `check_storage_limit(...)`
- `increment_tenant_storage_usage(...)`
- `sync_tenant_usage_counters(...)`
- `v_tenant_limit_health`
- the current repo-defined RLS policies and indexes for those objects
- tenant feature flag columns such as `allow_online_checkout`, `allow_custom_domain`, `allow_advanced_analytics`, and `allow_automation`

Recently promoted into `CATCHUP_RUN_THIS.sql` from older migrations:
- base `tenant_onboarding_requests` schema from `archive/onboarding-migration.sql`
- base `tenants`, `operators`, `operator_members`, `tenant_config`, and `tenant_settings` schema from `archive/phase3_tenants_migration.sql`
- tenant governance and storage helper objects from `tenant_governance_limits.sql`

### `diagnostic.sql`
Read-only diagnostic queries for inspecting the current database state.

### `service_workflow_phase1.sql`
Additive Phase 1 service-business workflow schema. Run this after `catchup_run_this.sql`.

It adds:
- `leads`
- `bids`
- `jobs`
- order payment-state normalization
- service intake and conversion RPCs
- service-workflow RLS/policy extensions
- payment-state recompute triggers and supporting indexes

### `proposal_document_engine.sql`
Additive proposal document schema. Run this after `catchup_run_this.sql` and `service_workflow_phase1.sql`.

It adds:
- `document_templates`
- `document_template_versions`
- `tenant_branding_profiles`
- `user_document_profiles`
- `proposal_documents`
- `proposal_document_versions`
- `proposal_options`
- `reusable_terms_templates`
- `reusable_exclusions_templates`
- tenant-scoped access helpers and RLS for shared proposal-document records
- seeded system layouts plus seeded default terms/exclusions

### `service_recurring_plans.sql`
Additive recurring-service schema. Run this after `catchup_run_this.sql` and `service_workflow_phase1.sql`.

It adds:
- `service_plans`
- recurring plan RLS/policy coverage
- `orders.service_plan_id`
- `jobs.service_plan_id`
- service-plan order/job generation RPCs
- recurring-order uniqueness guards and supporting indexes

This file already owns the recurring scheduled-date uniqueness guard on `public.orders` via:
- `idx_orders_service_plan_scheduled_date_unique`

Do not add or run a separate recurring-order idempotency migration for `orders`; the source-of-truth uniqueness guard already lives here under `service_plan_id`.

### `provision_failures.sql`
Additive platform-internal observability schema for failed tenant provisioning rollbacks. Run this after `catchup_run_this.sql`.

It adds:
- `provision_failures`
- platform-internal rollback failure tracking for provisioning cleanup
- service-role-only RLS/policy coverage
- partial indexes for onboarding request and tenant follow-up

### `service_deposit_control.sql`
Additive deposit-control schema. Run this after `catchup_run_this.sql` and `service_workflow_phase1.sql`.

If recurring plans are enabled in the same project, run this after `service_recurring_plans.sql` so the recurring-plan order generator is upgraded too.

It adds:
- `orders.deposit_policy`
- `orders.deposit_due_date`
- `orders.deposit_override_reason`
- `orders.deposit_override_at`
- `orders.deposit_override_by`
- deposit-policy enforcement triggers for orders and jobs
- bid-to-order deposit defaults
- recurring-plan deposit defaults when the recurring schema is present

### `hydrovac_module_foundation.sql`
Additive hydrovac / Vactor schema. Run this after `catchup_run_this.sql` and `service_workflow_phase1.sql`.

If recurring plans and deposit control are enabled too, you can run this after those files as well; it is additive and extends the existing service workflow rather than replacing it.

It adds:
- `utility_locate_tickets`
- `waste_manifests`
- `disposal_facilities`
- `tenant_hydrovac_settings`
- `confined_space_permits`
- `driver_qualifications`
- `infrastructure_assets`
- `job_time_segments`
- `equipment_maintenance_log`
- `compliance_alerts`
- hydrovac-specific `jobs` columns
- hydrovac-specific `equipment` columns
- tenant-scoped RLS coverage for the new hydrovac tables
- manifest-to-job rollup helpers and triggers

### `rebuild_supabase_full.sql`
Generated full rebuild bundle for a fresh Supabase project.

Build/update it with:

```bash
npm run sql:build:rebuild
```

The bundle currently concatenates, in this exact order:

1. `catchup_run_this.sql`
2. `service_workflow_phase1.sql`
3. `proposal_document_engine.sql`
4. `service_recurring_plans.sql`
5. `provision_failures.sql`
6. `service_deposit_control.sql`
7. `hydrovac_module_foundation.sql`

Do not edit `rebuild_supabase_full.sql` by hand. Update the source SQL files above and rebuild.

### `get_tenant_plan_limits_compat.sql`
Targeted repair script for older hosted environments that already have most governance schema, but need the final `get_tenant_plan_limits(...)` overloads reconciled without rerunning the full catch-up file.

### `sync_tenant_usage_counters_compat.sql`
Targeted repair script for hosted environments that already have the main schema, but still need the `sync_tenant_usage_counters(...)` ambiguity fix without rerunning the full catch-up file.

## Archive

The `/archive/` folder contains older migrations kept for reference. Some schema from those files has been promoted into `CATCHUP_RUN_THIS.sql`, but the archive should not be run directly on a live project because it contains overlapping definitions and older assumptions.

## Fresh project usage

1. Create a new Supabase project.
2. Open SQL Editor.
3. Run `catchup_run_this.sql`.
4. Run `service_workflow_phase1.sql`.
5. Run `proposal_document_engine.sql` if you want the versioned customer-facing proposal document system enabled.
6. Run `service_recurring_plans.sql` if you want recurring service plans enabled.
7. Run `provision_failures.sql` if you want provisioning rollback failures recorded for admin follow-up.
8. Run `service_deposit_control.sql` if you want deposit requirements, overrides, and booking/job enforcement enabled.
9. Run `hydrovac_module_foundation.sql` if you want hydrovac / Vactor compliance, manifest, and dispatch schema enabled.
10. Point `.env.test` or `TEST_*` secrets at that same project.
11. Run `npm run test:preflight:service-workflow`.
12. Set the required environment variables from the root `.env.example`.
13. Deploy or run the app against that project.

## Change process

1. Add core schema changes to `catchup_run_this.sql` when they belong in the base platform schema.
2. Add additive service-workflow changes to `service_workflow_phase1.sql` until they are intentionally promoted into catch-up.
3. Add proposal-document specific schema to `proposal_document_engine.sql` unless it truly belongs in the base catch-up file.
4. If the change is also needed as a safe live-environment repair, update `get_tenant_plan_limits_compat.sql`, `sync_tenant_usage_counters_compat.sql`, or add a similarly targeted helper.
5. Apply the same change in Supabase SQL Editor for the target environment.
6. Rerun `npm run test:preflight:service-workflow` against that environment when the change affects the service workflow.
7. Commit the SQL source-of-truth and any targeted live repair together.

## Standalone migration rollback

### `provision_failures.sql`
```sql
drop table if exists public.provision_failures;
```

### `service_recurring_plans.sql`
Do not roll this back casually on a live environment. It adds schema, functions, triggers, and RLS across recurring service features. If rollback is required, treat it as a dedicated migration project with data review first.

This keeps `CATCHUP_RUN_THIS.sql` current as the repo source of truth for the versioned core schema.

## Intentionally outside catch-up

`tenant_governance_limits.sql` is now mirrored into `CATCHUP_RUN_THIS.sql`, so the app's current limit-health and storage RPC dependencies are covered in the catch-up file.

Objects that may still exist in live environments but are not currently claimed as part of the repo source of truth should stay in standalone migrations until they are reconciled and promoted intentionally.
