alter table public.tenants
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists billing_status text default 'inactive',
  add column if not exists prooflink_plan_key text default 'starter';

create index if not exists idx_tenants_stripe_customer_id
  on public.tenants (stripe_customer_id);

create index if not exists idx_tenants_stripe_subscription_id
  on public.tenants (stripe_subscription_id);
