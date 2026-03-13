-- ProofLink payment + onboarding foundation
-- Safe, additive migration only.

create table if not exists public.onboarding_submissions (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  owner_name text not null,
  email text not null,
  phone text not null,
  business_category text not null,
  selected_plan text not null default 'starter',
  fulfillment_model text not null default 'pickup',
  service_area text,
  brand_color text,
  logo_url text,
  subdomain_preference text,
  domain_preference text not null default 'prooflink_subdomain',
  notes text,
  status text not null default 'submitted',
  billing_status text not null default 'manual_review',
  connect_status text not null default 'not_started',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_onboarding_submissions_status_created
  on public.onboarding_submissions (status, created_at desc);

alter table if exists public.payments add column if not exists stripe_account_id text;
alter table if exists public.payments add column if not exists stripe_customer_id text;
alter table if exists public.payments add column if not exists stripe_subscription_id text;
alter table if exists public.payments add column if not exists stripe_checkout_session_id text;
alter table if exists public.payments add column if not exists stripe_payment_intent_id text;
alter table if exists public.payments add column if not exists stripe_charge_id text;
alter table if exists public.payments add column if not exists payment_mode text;
alter table if exists public.payments add column if not exists amount_subtotal bigint;
alter table if exists public.payments add column if not exists amount_total bigint;
alter table if exists public.payments add column if not exists amount_platform_fee bigint;
alter table if exists public.payments add column if not exists currency text default 'usd';
alter table if exists public.payments add column if not exists livemode boolean default false;
alter table if exists public.payments add column if not exists metadata jsonb default '{}'::jsonb;
alter table if exists public.payments add column if not exists paid_at timestamptz;
alter table if exists public.payments add column if not exists refunded_at timestamptz;

create index if not exists idx_payments_tenant_status_created
  on public.payments (tenant_id, status, created_at desc);
create index if not exists idx_payments_tenant_order
  on public.payments (tenant_id, order_id);
create index if not exists idx_payments_tenant_checkout
  on public.payments (tenant_id, stripe_checkout_session_id);
create index if not exists idx_payments_tenant_subscription
  on public.payments (tenant_id, stripe_subscription_id);
