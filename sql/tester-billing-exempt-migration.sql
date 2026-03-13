-- ProofLink tester billing exemption
-- Additive only. Safe to run on existing database.
--
-- Adds two columns to tenants:
--   billing_exempt       boolean  — when true, tenant is treated as billing_status='active'
--                                   regardless of Stripe subscription state
--   billing_exempt_until timestamptz — exemption expires at this timestamp.
--                                      NULL means exempt indefinitely (not recommended).
--
-- Usage: set billing_exempt=true and billing_exempt_until = now() + interval '12 months'
-- for tester accounts. At expiry they drop back to normal billing gate on next request.

alter table if exists public.tenants
  add column if not exists billing_exempt       boolean     default false,
  add column if not exists billing_exempt_until timestamptz default null;

-- Index so the payments layer can check this efficiently
create index if not exists idx_tenants_billing_exempt
  on public.tenants (billing_exempt)
  where billing_exempt = true;

comment on column public.tenants.billing_exempt is
  'When true and billing_exempt_until is in the future (or null), tenant bypasses Stripe billing gate.';

comment on column public.tenants.billing_exempt_until is
  'UTC timestamp when billing exemption expires. NULL = indefinite (use with caution).';
