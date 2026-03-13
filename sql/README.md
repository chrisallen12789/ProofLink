# ProofLink — SQL Reference

## Active files (what matters)

### `CATCHUP_RUN_THIS.sql`
The single source of truth for the full database schema. Run this on any fresh Supabase project and you get everything. Safe to run — every statement uses `IF NOT EXISTS` or `ADD COLUMN IF NOT EXISTS`.

**What it creates:**
- `tenants` — all columns including Stripe, billing, governance, tester exempt, branding
- `tenant_onboarding_requests` — all columns including governance/evaluation fields
- `products` — full catalog table with pricing modes, images, sort order
- `pricing` — per-product cost and pricing detail
- `availability` — business hours, lead time, blackout dates
- `expenses` — per-job and monthly expense tracking
- `customers` — CRM customer records
- `orders` — storefront and CRM orders
- `payments` — Stripe payment records
- `customer_interactions` — timestamped interaction log per customer
- `tenant_conduct_log` — immutable audit trail of conduct actions
- `tenant_config` — key/value site settings per tenant
- `tenant_settings` — structured branding + contact per tenant
- `operator_members` — links operators to tenants with roles
- `operators` — authenticated users who can log in
- `pl_reserved_slugs` — admin-managed slug blocklist
- `pl_banned_keywords` — admin-managed keyword blocklist
- `pl_protected_brands` — admin-managed brand protection list
- `pl_prohibited_categories` — admin-managed category rules
- `profiles` — maps auth.users to platform roles (used for admin checks)
- `onboarding_requests` — view alias for `tenant_onboarding_requests` (backward compat)
- `operator_member_access()` — RLS helper function
- `submit_storefront_order()` — RPC used by storefront cart
- `get_public_catalog_by_tenant()` — RPC used by storefront product display
- All RLS policies and indexes

### `diagnostic.sql`
Run this any time to see a snapshot of every table and its column count. Useful for confirming a migration ran correctly.

---

## Archive (do not run)

The `/archive/` folder contains all old migration files from earlier development. They are kept for historical reference only. Everything they did is already covered by `CATCHUP_RUN_THIS.sql`.

**Do not run any archive files.** Several contain test data backfills, old table names, and duplicate statements that will conflict with the current schema.

---

## How to use on a fresh project

1. Create a new Supabase project
2. Open SQL Editor
3. Paste and run `CATCHUP_RUN_THIS.sql`
4. Set your Netlify environment variables (see `.env.example` in the root)
5. Deploy

## How to make schema changes going forward

1. Make the change in `CATCHUP_RUN_THIS.sql` (it's additive — add new columns/tables, don't remove)
2. Also run the specific change in your Supabase SQL editor directly
3. Commit both together

This keeps `CATCHUP_RUN_THIS.sql` always current as the single source of truth.
