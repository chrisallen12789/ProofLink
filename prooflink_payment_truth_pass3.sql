-- ProofLink payment truth pass 3
-- Safe additive normalization for billing/connect truth.

alter table if exists public.tenants
  add column if not exists online_payments_enabled boolean default false;

update public.tenants
set billing_status = 'onboarding'
where billing_status is null
   or billing_status in ('manual_review', 'pending', 'incomplete');

update public.tenants
set connect_status = 'connect_not_started'
where connect_status is null
   or connect_status in ('not_started', 'not_connected');

update public.tenants
set connect_status = 'connect_incomplete'
where connect_status in ('created', 'onboarding_started', 'restricted', 'pending');

update public.tenants
set connect_status = 'connect_connected'
where connect_status = 'connected';

create index if not exists idx_tenants_payment_gate
  on public.tenants (billing_status, connect_status, payments_enabled, online_payments_enabled);
