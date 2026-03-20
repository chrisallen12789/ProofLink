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
5. Point `.env.test` or `TEST_*` secrets at that same project.
6. Run `npm run test:preflight:service-workflow`.
7. Set the required environment variables from the root `.env.example`.
8. Deploy or run the app against that project.

## Change process

1. Add core schema changes to `catchup_run_this.sql` when they belong in the base platform schema.
2. Add additive service-workflow changes to `service_workflow_phase1.sql` until they are intentionally promoted into catch-up.
3. If the change is also needed as a safe live-environment repair, update `get_tenant_plan_limits_compat.sql`, `sync_tenant_usage_counters_compat.sql`, or add a similarly targeted helper.
4. Apply the same change in Supabase SQL Editor for the target environment.
5. Rerun `npm run test:preflight:service-workflow` against that environment when the change affects the service workflow.
6. Commit the SQL source-of-truth and any targeted live repair together.

This keeps `CATCHUP_RUN_THIS.sql` current as the repo source of truth for the versioned core schema.

## Intentionally outside catch-up

`tenant_governance_limits.sql` is now mirrored into `CATCHUP_RUN_THIS.sql`, so the app's current limit-health and storage RPC dependencies are covered in the catch-up file.

Objects that may still exist in live environments but are not currently claimed as part of the repo source of truth should stay in standalone migrations until they are reconciled and promoted intentionally.
