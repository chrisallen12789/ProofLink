-- ProofLink Stripe foundation pass 2
-- Additive only. Safe to run after PROOFLINK_PAYMENT_ONBOARDING_FOUNDATION.sql.

alter table if exists public.tenants add column if not exists prooflink_plan_key text;
alter table if exists public.tenants add column if not exists billing_status text default 'manual_review';
alter table if exists public.tenants add column if not exists stripe_customer_id text;
alter table if exists public.tenants add column if not exists stripe_subscription_id text;
alter table if exists public.tenants add column if not exists stripe_account_id text;
alter table if exists public.tenants add column if not exists connect_status text default 'not_connected';
alter table if exists public.tenants add column if not exists application_fee_bps integer default 0;
alter table if exists public.tenants add column if not exists payments_enabled boolean default false;
alter table if exists public.tenants add column if not exists custom_domain text;
alter table if exists public.tenants add column if not exists custom_domain_status text default 'not_connected';
alter table if exists public.tenants add column if not exists updated_at timestamptz default now();

alter table if exists public.onboarding_submissions add column if not exists requested_slug text;
alter table if exists public.onboarding_submissions add column if not exists stripe_customer_id text;
alter table if exists public.onboarding_submissions add column if not exists stripe_subscription_id text;
alter table if exists public.onboarding_submissions add column if not exists stripe_account_id text;
alter table if exists public.onboarding_submissions add column if not exists review_notes text;

alter table if exists public.payments add column if not exists updated_at timestamptz default now();
alter table if exists public.payments add column if not exists source text;

create index if not exists idx_tenants_billing_status on public.tenants (billing_status);
create index if not exists idx_tenants_connect_status on public.tenants (connect_status);
create index if not exists idx_payments_tenant_payment_intent on public.payments (tenant_id, stripe_payment_intent_id);
create index if not exists idx_payments_tenant_account on public.payments (tenant_id, stripe_account_id);
