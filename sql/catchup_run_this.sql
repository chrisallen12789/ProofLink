-- ============================================================================
-- ProofLink — Full Catch-Up Migration
-- Run this ONE TIME in your Supabase SQL editor.
-- Safe to run: every statement uses IF NOT EXISTS or ADD COLUMN IF NOT EXISTS.
-- This covers everything missing based on your current database state.
-- ============================================================================

-- ── 1. TENANTS — add all missing columns ────────────────────────────────────

-- 0. Foundation tables required by the live app

create table if not exists public.tenant_onboarding_requests (
  id                  uuid        primary key default gen_random_uuid(),
  status              text        not null default 'submitted',
  business_name       text        not null,
  business_slug       text,
  owner_name          text        not null,
  owner_email         text        not null,
  phone               text,
  business_type       text,
  city_state          text,
  requested_subdomain text,
  logo_url            text,
  seed_template_key   text,
  selected_plan       text        not null default 'starter',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  approved_at         timestamptz,
  provision_error     text,
  constraint tenant_onboarding_requests_status_check
    check (status in ('submitted','approved','provisioning','provisioned','failed'))
);

create index if not exists idx_onboarding_requests_status
  on public.tenant_onboarding_requests (status);
create index if not exists idx_onboarding_requests_email
  on public.tenant_onboarding_requests (owner_email);
create index if not exists idx_onboarding_requests_created_at
  on public.tenant_onboarding_requests (created_at desc);
create index if not exists idx_onboarding_requests_slug
  on public.tenant_onboarding_requests (business_slug)
  where business_slug is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_onboarding_updated_at on public.tenant_onboarding_requests;
create trigger trg_onboarding_updated_at
  before update on public.tenant_onboarding_requests
  for each row execute function public.set_updated_at();

alter table public.tenant_onboarding_requests enable row level security;

do $$ begin
  create policy "public_can_submit_onboarding"
    on public.tenant_onboarding_requests
    for insert
    to anon, authenticated
    with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "authenticated_can_read_onboarding"
    on public.tenant_onboarding_requests
    for select
    to authenticated
    using (true);
exception when duplicate_object then null;
end $$;

create table if not exists public.tenants (
  id                      uuid        primary key default gen_random_uuid(),
  name                    text        not null,
  slug                    text        not null unique,
  owner_email             text        not null,
  owner_name              text,
  business_type           text,
  city_state              text,
  logo_url                text,
  stripe_account_id       text,
  stripe_charges_enabled  boolean     default false,
  onboarding_request_id   uuid,
  setup_complete          boolean     default false,
  active                  boolean     default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists idx_tenants_slug        on public.tenants (slug);
create index if not exists idx_tenants_owner_email on public.tenants (owner_email);
create index if not exists idx_tenants_active      on public.tenants (active);
create index if not exists idx_tenants_created     on public.tenants (created_at desc);

create or replace function public.update_tenants_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tenants_updated_at_trigger on public.tenants;
create trigger tenants_updated_at_trigger
  before update on public.tenants
  for each row execute function public.update_tenants_updated_at();

alter table public.tenants enable row level security;

do $$ begin
  create policy "Service role full access on tenants"
    on public.tenants for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

create table if not exists public.operators (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null unique,
  name       text,
  role       text        not null default 'tenant_owner',
  tenant_id  uuid        references public.tenants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operators_role_check
    check (role in ('tenant_owner', 'admin', 'platform_admin'))
);

create index if not exists idx_operators_email     on public.operators (email);
create index if not exists idx_operators_tenant_id on public.operators (tenant_id);

alter table public.operators enable row level security;

do $$ begin
  create policy "Service role full access on operators"
    on public.operators for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

create table if not exists public.operator_members (
  operator_id uuid        not null references public.operators(id) on delete cascade,
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  role        text        not null default 'owner',
  invited_by  uuid        references public.operators(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (operator_id, tenant_id),
  constraint operator_members_role_check
    check (role in ('owner', 'manager', 'staff'))
);

create index if not exists idx_operator_members_tenant on public.operator_members (tenant_id);

alter table public.operator_members enable row level security;

do $$ begin
  create policy "Service role full access on operator_members"
    on public.operator_members for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

create or replace view public.operator_tenants as
select
  om.operator_id,
  om.tenant_id,
  om.role,
  om.invited_by,
  om.created_at,
  o.email as operator_email,
  o.name as operator_name,
  t.name as tenant_name,
  t.slug as tenant_slug
from public.operator_members om
join public.operators o on o.id = om.operator_id
join public.tenants t on t.id = om.tenant_id;

create table if not exists public.tenant_config (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants(id) on delete cascade,
  config_key   text        not null,
  config_value text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, config_key)
);

create index if not exists idx_tenant_config_tenant on public.tenant_config (tenant_id);

alter table public.tenant_config enable row level security;

do $$ begin
  create policy "Service role full access on tenant_config"
    on public.tenant_config for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

create table if not exists public.tenant_settings (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null unique references public.tenants(id) on delete cascade,
  branding       jsonb       not null default '{}'::jsonb,
  contact        jsonb       not null default '{}'::jsonb,
  business_hours jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create or replace function public.update_tenant_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tenant_settings_updated_at_trigger on public.tenant_settings;
create trigger tenant_settings_updated_at_trigger
  before update on public.tenant_settings
  for each row execute function public.update_tenant_settings_updated_at();

alter table public.tenant_settings enable row level security;

do $$ begin
  create policy "Service role full access on tenant_settings"
    on public.tenant_settings for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

alter table public.tenants
  add column if not exists prooflink_plan_key        text,
  add column if not exists billing_status            text        default 'onboarding',
  add column if not exists stripe_customer_id        text,
  add column if not exists stripe_subscription_id    text,
  add column if not exists stripe_connect_account_id text,
  add column if not exists connect_status            text        default 'connect_not_started',
  add column if not exists application_fee_bps       integer     default 0,
  add column if not exists payments_enabled          boolean     default false,
  add column if not exists online_payments_enabled   boolean     default false,
  add column if not exists custom_domain             text,
  add column if not exists custom_domain_status      text        default 'not_connected',
  add column if not exists last_stripe_connect_event text,
  add column if not exists status                    text        default 'active',
  add column if not exists conduct_action            text,
  add column if not exists conduct_reason            text,
  add column if not exists conduct_notes             text,
  add column if not exists conduct_updated_at        timestamptz,
  add column if not exists conduct_updated_by        uuid,
  add column if not exists flagged_at                timestamptz,
  add column if not exists suspended_at              timestamptz,
  add column if not exists terminated_at             timestamptz,
  add column if not exists billing_exempt            boolean     default false,
  add column if not exists billing_exempt_until      timestamptz,
  add column if not exists hero_image_url            text,
  add column if not exists license_number            text,
  add column if not exists instagram                 text,
  add column if not exists tagline                   text,
  add column if not exists product_count             integer     not null default 0,
  add column if not exists max_products              integer     not null default 10,
  add column if not exists customer_count            integer     not null default 0,
  add column if not exists max_customers             integer     not null default 50,
  add column if not exists operator_seat_count       integer     not null default 0,
  add column if not exists max_operator_seats        integer     not null default 1,
  add column if not exists current_month_order_count integer     not null default 0,
  add column if not exists max_orders_per_month      integer     not null default 100,
  add column if not exists storage_used_mb           numeric(12,2) not null default 0,
  add column if not exists max_storage_mb            numeric(12,2) not null default 100,
  add column if not exists allow_online_checkout     boolean     not null default false,
  add column if not exists allow_custom_domain       boolean     not null default false,
  add column if not exists allow_advanced_analytics  boolean     not null default false,
  add column if not exists allow_automation          boolean     not null default false,
  add column if not exists growth_score              numeric(12,2) not null default 0;

-- Status constraint for tenants
do $$ begin
  alter table public.tenants drop constraint if exists tenants_status_check;
exception when others then null;
end $$;

alter table public.tenants
  add constraint tenants_status_check
  check (status in ('provisioning','active','flagged','suspended','terminated','inactive'));

-- Backfill status from active boolean for existing rows
update public.tenants
  set status = case when active = false then 'inactive' else 'active' end
  where status is null;

-- Normalize billing/connect status for any existing rows
update public.tenants
  set billing_status = 'onboarding'
  where billing_status is null
     or billing_status in ('manual_review', 'pending', 'incomplete');

update public.tenants
  set connect_status = 'connect_not_started'
  where connect_status is null
     or connect_status in ('not_started', 'not_connected', '');

-- Indexes on tenants
create index if not exists idx_tenants_billing_status   on public.tenants (billing_status);
create index if not exists idx_tenants_connect_status   on public.tenants (connect_status);
create index if not exists idx_tenants_status           on public.tenants (status);
create index if not exists idx_tenants_billing_exempt   on public.tenants (billing_exempt) where billing_exempt = true;
create index if not exists idx_tenants_payment_gate     on public.tenants (billing_status, connect_status, payments_enabled, online_payments_enabled);


-- ── 2. TENANT_ONBOARDING_REQUESTS — add governance columns ──────────────────

alter table public.tenant_onboarding_requests
  add column if not exists risk_level        text,
  add column if not exists reason_codes      text[],
  add column if not exists evaluation_result jsonb,
  add column if not exists evaluated_at      timestamptz,
  add column if not exists admin_notes       text,
  add column if not exists compliance_notes  text,
  add column if not exists manual_override   boolean default false,
  add column if not exists reviewed_by       uuid,
  add column if not exists reviewed_at       timestamptz,
  add column if not exists selected_plan     text        not null default 'starter';

-- Extend status constraint to include all values the code uses
do $$ begin
  alter table public.tenant_onboarding_requests drop constraint if exists onboarding_status_check;
exception when others then null;
end $$;

alter table public.tenant_onboarding_requests
  add constraint onboarding_status_check
  check (status in (
    'submitted',
    'needs_review',
    'approved',
    'provisioning',
    'provisioned',
    'failed',
    'rejected'
  ));

create index if not exists idx_onboarding_needs_review on public.tenant_onboarding_requests (status) where status = 'needs_review';
create index if not exists idx_onboarding_risk         on public.tenant_onboarding_requests (risk_level);


-- ── 3. PRODUCTS table ────────────────────────────────────────────────────────

create table if not exists public.products (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            text        not null,
  operator_id          uuid        not null,
  name                 text        not null,
  slug                 text        not null,
  category             text,
  description          text,
  ingredients          text[],
  image_url            text,
  pricing_mode         text        not null default 'quote',
  sell_price_cents     integer     not null default 0,
  starting_price_cents integer     not null default 0,
  delivery_eligible    boolean     not null default true,
  is_active            boolean     not null default false,
  is_available         boolean     not null default true,
  sort_order           integer     not null default 0,
  trial_product_id     uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_products_tenant_operator on public.products (tenant_id, operator_id);
create index if not exists idx_products_tenant_active   on public.products (tenant_id, is_active);
create index if not exists idx_products_tenant_slug     on public.products (tenant_id, slug);

alter table public.products enable row level security;

do $$ begin
  create policy "Service role full access on products"
    on public.products for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;


-- ── 4. PRICING table ─────────────────────────────────────────────────────────

create table if not exists public.pricing (
  id                      uuid        primary key default gen_random_uuid(),
  tenant_id               text        not null,
  operator_id             uuid        not null,
  product_id              uuid        references public.products(id) on delete cascade,
  unit_label              text        default 'each',
  sell_price_cents        integer     not null default 0,
  starting_price_cents    integer     not null default 0,
  cost_ingredients_cents  integer     not null default 0,
  cost_packaging_cents    integer     not null default 0,
  labor_minutes           integer     not null default 0,
  notes                   text,
  pricing_mode            text        default 'quote',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists idx_pricing_tenant_operator on public.pricing (tenant_id, operator_id);
create index if not exists idx_pricing_product         on public.pricing (product_id);

alter table public.pricing enable row level security;

do $$ begin
  create policy "Service role full access on pricing"
    on public.pricing for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;


-- ── 5. AVAILABILITY table ────────────────────────────────────────────────────

create table if not exists public.availability (
  id               uuid        primary key default gen_random_uuid(),
  tenant_id        text        not null,
  operator_id      uuid        not null,
  timezone         text        not null default 'America/New_York',
  lead_time_hours  integer     not null default 24,
  max_orders_per_day integer   not null default 0,
  rules            jsonb       not null default '[]'::jsonb,
  blackout_dates   jsonb       not null default '[]'::jsonb,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, operator_id)
);

create index if not exists idx_availability_tenant_operator on public.availability (tenant_id, operator_id);

alter table public.availability enable row level security;

do $$ begin
  create policy "Service role full access on availability"
    on public.availability for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;


-- ── 6. EXPENSES table ────────────────────────────────────────────────────────

create table if not exists public.expenses (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    text        not null,
  operator_id  uuid        not null,
  date         date,
  expense_date date,
  category     text,
  vendor       text,
  description  text,
  notes        text,
  amount_cents integer     not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_expenses_tenant_operator on public.expenses (tenant_id, operator_id);
create index if not exists idx_expenses_tenant_date     on public.expenses (tenant_id, date desc);

alter table public.expenses enable row level security;

do $$ begin
  create policy "Service role full access on expenses"
    on public.expenses for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;


-- ── 7. CUSTOMERS table ───────────────────────────────────────────────────────

create table if not exists public.customers (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            text        not null,
  operator_id          uuid        not null,
  name                 text,
  email                text,
  phone                text,
  preferred_contact    text        default 'email',
  notes                text,
  lifetime_value_cents integer     not null default 0,
  order_count          integer     not null default 0,
  last_contact_at      timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_customers_tenant_operator on public.customers (tenant_id, operator_id);
create index if not exists idx_customers_tenant_email    on public.customers (tenant_id, lower(email));
create unique index if not exists uq_customers_tenant_email_lower
  on public.customers (tenant_id, lower(email))
  where email is not null and btrim(email) <> '';

alter table public.customers enable row level security;

do $$ begin
  create policy "Service role full access on customers"
    on public.customers for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;


-- ── 8. ORDERS table ──────────────────────────────────────────────────────────

create table if not exists public.orders (
  id                    uuid        primary key default gen_random_uuid(),
  tenant_id             text        not null,
  operator_id           uuid,
  customer_id           uuid        references public.customers(id) on delete set null,
  status                text        not null default 'new',
  fulfillment           text,
  scheduled_date        date,
  scheduled_time        text,
  items                 jsonb       not null default '[]'::jsonb,
  subtotal_cents        integer     not null default 0,
  delivery_fee_cents    integer     not null default 0,
  total_cents           integer     not null default 0,
  estimated_total_cents integer     not null default 0,
  item_count            integer     not null default 0,
  unpriced_count        integer     not null default 0,
  cart_summary          text,
  notes                 text,
  customer_name         text,
  email                 text,
  phone                 text,
  preferred_contact     text,
  source_type           text        default 'storefront',
  source_ref            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint orders_status_allowed
    check (status is null or lower(status) in ('new','confirmed','fulfilled','cancelled','paid','completed','quoted')),
  constraint orders_items_not_empty
    check (items is not null and jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0)
);

create index if not exists idx_orders_tenant_operator   on public.orders (tenant_id, operator_id);
create index if not exists idx_orders_tenant_status     on public.orders (tenant_id, status, created_at desc);
create index if not exists idx_orders_customer          on public.orders (customer_id, created_at desc);

alter table public.orders enable row level security;

do $$ begin
  create policy "Service role full access on orders"
    on public.orders for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;


-- ── 9. PAYMENTS table ────────────────────────────────────────────────────────

create table if not exists public.payments (
  id                         uuid        primary key default gen_random_uuid(),
  tenant_id                  text        not null,
  operator_id                uuid,
  order_id                   uuid        references public.orders(id) on delete set null,
  customer_id                uuid        references public.customers(id) on delete set null,
  stripe_account_id          text,
  stripe_customer_id         text,
  stripe_subscription_id     text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  stripe_charge_id           text,
  payment_mode               text,
  status                     text        not null default 'pending',
  amount_subtotal            bigint,
  amount_total               bigint,
  amount_platform_fee        bigint,
  currency                   text        default 'usd',
  livemode                   boolean     default false,
  metadata                   jsonb       default '{}'::jsonb,
  source                     text,
  paid_at                    timestamptz,
  refunded_at                timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create index if not exists idx_payments_tenant_operator       on public.payments (tenant_id, operator_id);
create index if not exists idx_payments_tenant_status         on public.payments (tenant_id, status, created_at desc);
create index if not exists idx_payments_tenant_order          on public.payments (tenant_id, order_id);
create index if not exists idx_payments_tenant_checkout       on public.payments (tenant_id, stripe_checkout_session_id);
create index if not exists idx_payments_tenant_subscription   on public.payments (tenant_id, stripe_subscription_id);
create index if not exists idx_payments_tenant_payment_intent on public.payments (tenant_id, stripe_payment_intent_id);
create index if not exists idx_payments_tenant_account        on public.payments (tenant_id, stripe_account_id);

alter table public.payments enable row level security;

do $$ begin
  create policy "Service role full access on payments"
    on public.payments for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;


-- ── 10. CUSTOMER_INTERACTIONS table ─────────────────────────────────────────

create table if not exists public.customer_interactions (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   text        not null,
  operator_id uuid        not null,
  customer_id uuid        references public.customers(id) on delete cascade,
  order_id    uuid        references public.orders(id) on delete set null,
  type        text        not null default 'note',
  summary     text,
  metadata    jsonb       default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_customer_interactions_tenant_operator on public.customer_interactions (tenant_id, operator_id);
create index if not exists idx_customer_interactions_customer        on public.customer_interactions (customer_id, created_at desc);

alter table public.customer_interactions enable row level security;

do $$ begin
  create policy "Service role full access on customer_interactions"
    on public.customer_interactions for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;


-- ── 11. GOVERNANCE tables ────────────────────────────────────────────────────

create table if not exists public.tenant_conduct_log (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants(id) on delete cascade,
  action       text        not null check (action in ('flag','suspend','reinstate','terminate')),
  reason_code  text,
  admin_notes  text,
  performed_by uuid,
  performed_at timestamptz not null default now()
);

create index if not exists idx_conduct_log_tenant on public.tenant_conduct_log (tenant_id);
create index if not exists idx_conduct_log_at     on public.tenant_conduct_log (performed_at desc);

alter table public.tenant_conduct_log enable row level security;

do $$ begin
  create policy "Service role full access on tenant_conduct_log"
    on public.tenant_conduct_log for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

create table if not exists public.pl_reserved_slugs (
  id         uuid        primary key default gen_random_uuid(),
  slug       text        not null unique,
  reason     text,
  active     boolean     not null default true,
  created_at timestamptz default now()
);

insert into public.pl_reserved_slugs (slug, reason) values
  ('shop',    'generic'), ('store', 'generic'), ('checkout', 'platform reserved'),
  ('payment', 'platform reserved'), ('health', 'platform reserved')
on conflict (slug) do nothing;

alter table public.pl_reserved_slugs enable row level security;

do $$ begin
  create policy "Service role full access on pl_reserved_slugs"
    on public.pl_reserved_slugs for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

create table if not exists public.pl_banned_keywords (
  id         uuid    primary key default gen_random_uuid(),
  keyword    text    not null,
  category   text    not null,
  verdict    text    not null default 'REJECT' check (verdict in ('REJECT','FLAG')),
  active     boolean not null default true,
  notes      text,
  created_at timestamptz default now()
);

alter table public.pl_banned_keywords enable row level security;

do $$ begin
  create policy "Service role full access on pl_banned_keywords"
    on public.pl_banned_keywords for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

create table if not exists public.pl_protected_brands (
  id         uuid    primary key default gen_random_uuid(),
  name       text    not null unique,
  active     boolean not null default true,
  notes      text,
  created_at timestamptz default now()
);

insert into public.pl_protected_brands (name, notes) values
  ('ebay', 'brand protection'), ('etsy', 'brand protection'),
  ('square', 'brand protection'), ('quickbooks', 'brand protection')
on conflict (name) do nothing;

alter table public.pl_protected_brands enable row level security;

do $$ begin
  create policy "Service role full access on pl_protected_brands"
    on public.pl_protected_brands for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

create table if not exists public.pl_prohibited_categories (
  id         uuid    primary key default gen_random_uuid(),
  name       text    not null unique,
  keywords   text[]  not null,
  verdict    text    not null default 'REJECT' check (verdict in ('REJECT','FLAG')),
  notes      text,
  active     boolean not null default true,
  created_at timestamptz default now()
);

insert into public.pl_prohibited_categories (name, keywords, verdict, notes) values
  ('cannabis', ARRAY['cannabis','dispensary','marijuana','cbd store','thc products',
    'weed shop','pot shop','420 store','hemp flower','dispo',
    'recreational cannabis','medical marijuana'],
  'FLAG', 'Restricted — manual review required.')
on conflict (name) do nothing;

alter table public.pl_prohibited_categories enable row level security;

do $$ begin
  create policy "Service role full access on pl_prohibited_categories"
    on public.pl_prohibited_categories for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;


-- ── 12. RLS — operator-scoped access for authenticated users ─────────────────

-- Helper function: returns true if the current auth user is a member of the operator
create or replace function public.operator_member_access(target_operator_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.operator_members om
    where om.user_id = auth.uid()
      and om.operator_id = target_operator_id
  );
$$;

revoke all on function public.operator_member_access(uuid) from public;
grant execute on function public.operator_member_access(uuid) to authenticated, service_role;

create or replace function public.operator_member_tenant_access(target_operator_id uuid, target_tenant_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_operator_id is not null
    and nullif(btrim(coalesce(target_tenant_id, '')), '') is not null
    and exists (
      select 1
      from public.operator_members om
      where om.user_id = auth.uid()
        and om.operator_id = target_operator_id
        and om.tenant_id::text = btrim(target_tenant_id)
    );
$$;

revoke all on function public.operator_member_tenant_access(uuid, text) from public;
grant execute on function public.operator_member_tenant_access(uuid, text) to authenticated, service_role;

create or replace function public.enforce_operator_tenant_membership_pair()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.operator_id is null or nullif(btrim(coalesce(new.tenant_id, '')), '') is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.operator_members om
    where om.operator_id = new.operator_id
      and om.tenant_id::text = btrim(new.tenant_id)
  ) then
    raise exception using
      errcode = '23503',
      message = format(
        'operator_id %s is not a member of tenant_id %s',
        new.operator_id,
        new.tenant_id
      ),
      detail = format(
        '%s requires a valid operator_members(operator_id, tenant_id) pair',
        tg_table_name
      );
  end if;

  return new;
end;
$$;

drop trigger if exists products_operator_tenant_pair_guard on public.products;
create trigger products_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.products
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists pricing_operator_tenant_pair_guard on public.pricing;
create trigger pricing_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.pricing
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists availability_operator_tenant_pair_guard on public.availability;
create trigger availability_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.availability
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists expenses_operator_tenant_pair_guard on public.expenses;
create trigger expenses_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.expenses
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists customers_operator_tenant_pair_guard on public.customers;
create trigger customers_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.customers
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists orders_operator_tenant_pair_guard on public.orders;
create trigger orders_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.orders
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists payments_operator_tenant_pair_guard on public.payments;
create trigger payments_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.payments
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists customer_interactions_operator_tenant_pair_guard on public.customer_interactions;
create trigger customer_interactions_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.customer_interactions
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

grant usage on schema public to authenticated;
grant select on public.operator_members to authenticated;
grant select on public.operators to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.pricing to authenticated;
grant select, insert, update, delete on public.availability to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.payments to authenticated;
grant select, insert, update, delete on public.customer_interactions to authenticated;

-- Operator members: user can only see their own memberships
do $$ begin
  drop policy if exists operator_members_self_read on public.operator_members;
  create policy operator_members_self_read
    on public.operator_members for select to authenticated
    using (user_id = auth.uid());
exception when others then null;
end $$;

-- Operators: visible if you are a member
do $$ begin
  drop policy if exists operators_member_read on public.operators;
  create policy operators_member_read
    on public.operators for select to authenticated
    using (public.operator_member_access(id));
exception when others then null;
end $$;

-- All tenant-scoped tables: operator must be a member
do $$ begin
  drop policy if exists products_operator_all on public.products;
  create policy products_operator_all on public.products for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists pricing_operator_all on public.pricing;
  create policy pricing_operator_all on public.pricing for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists availability_operator_all on public.availability;
  create policy availability_operator_all on public.availability for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists expenses_operator_all on public.expenses;
  create policy expenses_operator_all on public.expenses for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists customers_operator_all on public.customers;
  create policy customers_operator_all on public.customers for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists orders_operator_all on public.orders;
  create policy orders_operator_all on public.orders for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists payments_operator_all on public.payments;
  create policy payments_operator_all on public.payments for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists customer_interactions_operator_all on public.customer_interactions;
  create policy customer_interactions_operator_all on public.customer_interactions for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;


-- ── 13. submit_storefront_order RPC ─────────────────────────────────────────
-- Called by supabase-order-proxy.js to save a storefront order atomically.

create or replace function public.submit_storefront_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id            text    := nullif(trim(coalesce(payload->>'tenant_id', '')), '');
  v_tenant_slug          text    := nullif(trim(coalesce(payload->>'tenant_slug', '')), '');
  v_operator_id          uuid;
  v_customer_id          uuid;
  v_order_id             uuid;
  v_customer_name        text    := nullif(trim(coalesce(payload->>'customer_name', '')), '');
  v_email                text    := lower(nullif(trim(coalesce(payload->>'email', '')), ''));
  v_phone                text    := nullif(trim(coalesce(payload->>'phone', '')), '');
  v_preferred_contact    text    := coalesce(nullif(trim(payload->>'preferred_contact'), ''), 'email');
  v_status               text    := 'new';
  v_fulfillment          text    := coalesce(nullif(trim(payload->>'fulfillment'), ''), 'pickup');
  v_scheduled_date       date    := nullif(payload->>'scheduled_date', '')::date;
  v_scheduled_time       text    := nullif(trim(coalesce(payload->>'scheduled_time', '')), '');
  v_items                jsonb   := coalesce(payload->'items', '[]'::jsonb);
  v_subtotal_cents       integer := greatest(coalesce((payload->>'subtotal_cents')::integer, 0), 0);
  v_delivery_fee_cents   integer := greatest(coalesce((payload->>'delivery_fee_cents')::integer, 0), 0);
  v_total_cents          integer := greatest(coalesce((payload->>'total_cents')::integer, 0), 0);
  v_estimated_total_cents integer := greatest(coalesce((payload->>'estimated_total_cents')::integer, v_total_cents), 0);
  v_item_count           integer := greatest(coalesce((payload->>'item_count')::integer, jsonb_array_length(v_items)), 0);
  v_unpriced_count       integer := greatest(coalesce((payload->>'unpriced_count')::integer, 0), 0);
  v_notes                text    := nullif(trim(coalesce(payload->>'notes', '')), '');
  v_cart_summary         text    := nullif(trim(coalesce(payload->>'cart_summary', '')), '');
  v_source_type          text    := coalesce(nullif(trim(payload->>'source_type'), ''), 'storefront');
begin
  if v_tenant_id is null then
    raise exception 'submit_storefront_order: tenant_id is required';
  end if;
  if v_customer_name is null then
    raise exception 'submit_storefront_order: customer_name is required';
  end if;
  if v_email is null then
    raise exception 'submit_storefront_order: email is required';
  end if;
  if v_phone is null then
    raise exception 'submit_storefront_order: phone is required';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'submit_storefront_order: items are required';
  end if;

  if v_tenant_slug is not null then
    perform 1
    from public.tenants t
    where t.id::text = v_tenant_id
      and t.slug = v_tenant_slug
      and coalesce(t.active, true) = true;

    if not found then
      raise exception 'submit_storefront_order: tenant_id and tenant_slug do not match';
    end if;
  end if;

  -- Find the operator for this tenant
  select o.id into v_operator_id
  from public.operators o
  where o.tenant_id::text = v_tenant_id
  order by o.created_at nulls first, o.id
  limit 1;

  if v_operator_id is null then
    raise exception 'submit_storefront_order: no operator found for tenant %', v_tenant_id;
  end if;

  -- Upsert customer
  select c.id into v_customer_id
  from public.customers c
  where c.tenant_id = v_tenant_id
    and c.operator_id = v_operator_id
    and (
      (v_email is not null and lower(c.email) = v_email)
      or (v_phone is not null and c.phone = v_phone)
    )
  order by c.updated_at desc nulls last, c.created_at desc nulls last
  limit 1;

  if v_customer_id is null then
    insert into public.customers (
      tenant_id, operator_id, name, email, phone, preferred_contact, notes,
      lifetime_value_cents, order_count, last_contact_at, created_at, updated_at
    ) values (
      v_tenant_id, v_operator_id, v_customer_name, v_email, v_phone, v_preferred_contact, v_notes,
      0, 0, now(), now(), now()
    )
    returning id into v_customer_id;
  else
    update public.customers
       set name             = v_customer_name,
           email            = coalesce(v_email, email),
           phone            = coalesce(v_phone, phone),
           preferred_contact = v_preferred_contact,
           last_contact_at  = now(),
           updated_at       = now()
     where id = v_customer_id;
  end if;

  -- Insert order
  insert into public.orders (
    tenant_id, operator_id, customer_id, status, fulfillment,
    scheduled_date, scheduled_time, items, subtotal_cents, delivery_fee_cents,
    total_cents, estimated_total_cents, item_count, unpriced_count,
    notes, cart_summary, customer_name, email, phone, preferred_contact,
    source_type, source_ref, created_at, updated_at
  ) values (
    v_tenant_id, v_operator_id, v_customer_id, v_status, v_fulfillment,
    v_scheduled_date, v_scheduled_time, v_items, v_subtotal_cents, v_delivery_fee_cents,
    v_total_cents, v_estimated_total_cents, v_item_count, v_unpriced_count,
    v_notes, v_cart_summary, v_customer_name, v_email, v_phone, v_preferred_contact,
    v_source_type, v_tenant_slug, now(), now()
  )
  returning id into v_order_id;

  -- Update customer lifetime value
  update public.customers
     set lifetime_value_cents = coalesce(lifetime_value_cents, 0) + v_total_cents,
         order_count          = coalesce(order_count, 0) + 1,
         updated_at           = now()
   where id = v_customer_id;

  return jsonb_build_object(
    'ok',          true,
    'order_id',    v_order_id,
    'customer_id', v_customer_id,
    'operator_id', v_operator_id,
    'tenant_id',   v_tenant_id
  );
end;
$$;

revoke all on function public.submit_storefront_order(jsonb) from public;
grant execute on function public.submit_storefront_order(jsonb) to service_role;


-- ── 14. get_public_catalog_by_tenant RPC ────────────────────────────────────
-- Called by the storefront to load the product catalog for a tenant.

create or replace function public.get_public_catalog_by_tenant(p_tenant_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_agg(
    jsonb_build_object(
      'id',                    p.id,
      'name',                  p.name,
      'slug',                  p.slug,
      'category',              p.category,
      'description',           p.description,
      'ingredients',           p.ingredients,
      'image_url',             p.image_url,
      'pricing_mode',          p.pricing_mode,
      'sell_price_cents',      p.sell_price_cents,
      'starting_price_cents',  p.starting_price_cents,
      'delivery_eligible',     p.delivery_eligible,
      'is_available',          p.is_available,
      'sort_order',            p.sort_order,
      'trial_product_id',      p.trial_product_id
    )
    order by p.sort_order asc, p.name asc
  )
  into v_result
  from public.products p
  join public.operators o on o.id = p.operator_id
  join public.tenants t   on t.id::text = p.tenant_id
  where t.slug = p_tenant_slug
    and p.is_active = true
    and p.is_available = true;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke all on function public.get_public_catalog_by_tenant(text) from public;
grant execute on function public.get_public_catalog_by_tenant(text) to anon, authenticated, service_role;

-- 15a. Hosted plan-limit compatibility

create table if not exists public.plan_limits (
  plan_key                 text primary key,
  max_products             integer,
  max_customers            integer,
  max_orders_per_month     integer,
  max_operator_seats       integer,
  max_storage_mb           numeric(12,2),
  allow_online_checkout    boolean not null default false,
  allow_custom_domain      boolean not null default false,
  allow_advanced_analytics boolean not null default false,
  allow_automation         boolean not null default false
);

insert into public.plan_limits (
  plan_key,
  max_products,
  max_customers,
  max_orders_per_month,
  max_operator_seats,
  max_storage_mb,
  allow_online_checkout,
  allow_custom_domain,
  allow_advanced_analytics,
  allow_automation
)
values
  ('starter', 10, 50, 100, 1, 100, false, false, false, false),
  ('growth', 100, 1000, 500, 5, 500, true, false, true, false),
  ('enterprise', null, null, null, null, null, true, true, true, true)
on conflict (plan_key) do update
set
  max_products = excluded.max_products,
  max_customers = excluded.max_customers,
  max_orders_per_month = excluded.max_orders_per_month,
  max_operator_seats = excluded.max_operator_seats,
  max_storage_mb = excluded.max_storage_mb,
  allow_online_checkout = excluded.allow_online_checkout,
  allow_custom_domain = excluded.allow_custom_domain,
  allow_advanced_analytics = excluded.allow_advanced_analytics,
  allow_automation = excluded.allow_automation;

drop function if exists public.get_tenant_plan_limits(text);

create or replace function public.get_tenant_plan_limits(p_tenant_id uuid)
returns table (
  plan_key text,
  max_products integer,
  max_customers integer,
  max_orders_per_month integer,
  max_operator_seats integer,
  max_storage_mb integer,
  allow_online_checkout boolean,
  allow_custom_domain boolean,
  allow_advanced_analytics boolean,
  allow_automation boolean,
  billing_exempt boolean
)
language sql
stable
set search_path = public
as $$
  select
    coalesce(t.prooflink_plan_key, 'starter') as plan_key,
    case when p.plan_key is not null then coalesce(t.max_products, p.max_products) else coalesce(t.max_products, 10) end as max_products,
    case when p.plan_key is not null then coalesce(t.max_customers, p.max_customers) else coalesce(t.max_customers, 50) end as max_customers,
    case when p.plan_key is not null then coalesce(t.max_orders_per_month, p.max_orders_per_month) else coalesce(t.max_orders_per_month, 100) end as max_orders_per_month,
    case when p.plan_key is not null then coalesce(t.max_operator_seats, p.max_operator_seats) else coalesce(t.max_operator_seats, 1) end as max_operator_seats,
    case when p.plan_key is not null then coalesce(t.max_storage_mb::integer, p.max_storage_mb::integer) else coalesce(t.max_storage_mb::integer, 100) end as max_storage_mb,
    coalesce(t.allow_online_checkout, p.allow_online_checkout, false) as allow_online_checkout,
    coalesce(t.allow_custom_domain, p.allow_custom_domain, false) as allow_custom_domain,
    coalesce(t.allow_advanced_analytics, p.allow_advanced_analytics, false) as allow_advanced_analytics,
    coalesce(t.allow_automation, p.allow_automation, false) as allow_automation,
    coalesce(t.billing_exempt, false) as billing_exempt
  from public.tenants t
  left join public.plan_limits p
    on p.plan_key = coalesce(t.prooflink_plan_key, 'starter')
  where t.id = p_tenant_id
  limit 1;
$$;

create function public.get_tenant_plan_limits(p_tenant_ref text)
returns table (
  plan_key text,
  max_products integer,
  max_customers integer,
  max_orders_per_month integer,
  max_operator_seats integer,
  max_storage_mb integer,
  allow_online_checkout boolean,
  allow_custom_domain boolean,
  allow_advanced_analytics boolean,
  allow_automation boolean,
  billing_exempt boolean
)
language sql
stable
set search_path = public
as $$
  select
    coalesce(t.prooflink_plan_key, 'starter') as plan_key,
    case when p.plan_key is not null then coalesce(t.max_products, p.max_products) else coalesce(t.max_products, 10) end as max_products,
    case when p.plan_key is not null then coalesce(t.max_customers, p.max_customers) else coalesce(t.max_customers, 50) end as max_customers,
    case when p.plan_key is not null then coalesce(t.max_orders_per_month, p.max_orders_per_month) else coalesce(t.max_orders_per_month, 100) end as max_orders_per_month,
    case when p.plan_key is not null then coalesce(t.max_operator_seats, p.max_operator_seats) else coalesce(t.max_operator_seats, 1) end as max_operator_seats,
    case when p.plan_key is not null then coalesce(t.max_storage_mb::integer, p.max_storage_mb::integer) else coalesce(t.max_storage_mb::integer, 100) end as max_storage_mb,
    coalesce(t.allow_online_checkout, p.allow_online_checkout, false) as allow_online_checkout,
    coalesce(t.allow_custom_domain, p.allow_custom_domain, false) as allow_custom_domain,
    coalesce(t.allow_advanced_analytics, p.allow_advanced_analytics, false) as allow_advanced_analytics,
    coalesce(t.allow_automation, p.allow_automation, false) as allow_automation,
    coalesce(t.billing_exempt, false) as billing_exempt
  from public.tenants t
  left join public.plan_limits p
    on p.plan_key = coalesce(t.prooflink_plan_key, 'starter')
  where t.id::text = nullif(btrim(p_tenant_ref), '')
     or t.slug = nullif(btrim(p_tenant_ref), '')
  limit 1;
$$;

notify pgrst, 'reload schema';


-- ── 15. Tenant governance and storage helpers ───────────────────────────────

create or replace function public.resolve_tenant_row(p_tenant_ref text)
returns public.tenants
language sql
stable
set search_path = public
as $$
  select t.*
  from public.tenants t
  where t.id::text = nullif(btrim(p_tenant_ref), '')
     or t.slug = nullif(btrim(p_tenant_ref), '')
  limit 1;
$$;

create or replace function public.sync_tenant_usage_counters(p_tenant_id text)
returns table (
  tenant_id uuid,
  product_count integer,
  customer_count integer,
  operator_seat_count integer,
  current_month_order_count integer
)
language plpgsql
set search_path = public
as $$
declare
  v_tenant public.tenants;
  v_product_count integer := 0;
  v_customer_count integer := 0;
  v_operator_count integer := 0;
  v_order_count integer := 0;
begin
  select * into v_tenant
  from public.resolve_tenant_row(p_tenant_id);

  if v_tenant.id is null then
    raise exception 'Tenant not found for usage sync: %', p_tenant_id
      using errcode = 'P0002';
  end if;

  select count(*)::integer into v_product_count
  from public.products p
  where p.tenant_id = v_tenant.id::text;

  select count(*)::integer into v_customer_count
  from public.customers c
  where c.tenant_id = v_tenant.id::text;

  select count(*)::integer into v_operator_count
  from public.operator_members om
  where om.tenant_id = v_tenant.id;

  select count(*)::integer into v_order_count
  from public.orders o
  where o.tenant_id = v_tenant.id::text
    and o.created_at >= date_trunc('month', timezone('utc', now()));

  update public.tenants
    set product_count = v_product_count,
        customer_count = v_customer_count,
        operator_seat_count = v_operator_count,
        current_month_order_count = v_order_count,
        growth_score = round(((v_product_count * 1.0) + (v_customer_count * 0.25) + (v_order_count * 0.1) + (v_operator_count * 2.0))::numeric, 2)
  where id = v_tenant.id;

  return query
  select
    v_tenant.id,
    v_product_count,
    v_customer_count,
    v_operator_count,
    v_order_count;
end;
$$;

create or replace function public.check_storage_limit(
  p_tenant_id text default null,
  p_bytes bigint default null,
  p_storage_mb numeric default null,
  tenant_id text default null,
  bytes bigint default null,
  storage_mb numeric default null
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_tenant_ref text := coalesce(nullif(btrim(p_tenant_id), ''), nullif(btrim(tenant_id), ''));
  v_tenant public.tenants;
  v_incoming_mb numeric := coalesce(p_storage_mb, storage_mb, coalesce(p_bytes, bytes, 0)::numeric / 1024 / 1024);
  v_next_mb numeric;
begin
  select * into v_tenant
  from public.resolve_tenant_row(v_tenant_ref);

  if v_tenant.id is null then
    raise exception 'Tenant not found for storage check: %', v_tenant_ref
      using errcode = 'P0002';
  end if;

  v_next_mb := coalesce(v_tenant.storage_used_mb, 0) + coalesce(v_incoming_mb, 0);

  if coalesce(v_tenant.max_storage_mb, 0) > 0 and v_next_mb > v_tenant.max_storage_mb then
    return jsonb_build_object(
      'ok', false,
      'code', 'storage_limit_reached',
      'tenant_id', v_tenant.id,
      'storage_used_mb', coalesce(v_tenant.storage_used_mb, 0),
      'storage_limit_mb', coalesce(v_tenant.max_storage_mb, 0),
      'incoming_mb', coalesce(v_incoming_mb, 0),
      'projected_storage_mb', v_next_mb,
      'error', 'Storage limit reached'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'tenant_id', v_tenant.id,
    'storage_used_mb', coalesce(v_tenant.storage_used_mb, 0),
    'storage_limit_mb', coalesce(v_tenant.max_storage_mb, 0),
    'incoming_mb', coalesce(v_incoming_mb, 0),
    'projected_storage_mb', v_next_mb
  );
end;
$$;

create or replace function public.increment_tenant_storage_usage(
  p_tenant_id text default null,
  p_bytes bigint default null,
  p_storage_mb numeric default null,
  tenant_id text default null,
  bytes bigint default null,
  storage_mb numeric default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_tenant_ref text := coalesce(nullif(btrim(p_tenant_id), ''), nullif(btrim(tenant_id), ''));
  v_tenant public.tenants;
  v_increment_mb numeric := coalesce(p_storage_mb, storage_mb, coalesce(p_bytes, bytes, 0)::numeric / 1024 / 1024);
  v_check jsonb;
  v_next_mb numeric;
begin
  v_check := public.check_storage_limit(
    p_tenant_id := p_tenant_id,
    p_bytes := p_bytes,
    p_storage_mb := p_storage_mb,
    tenant_id := tenant_id,
    bytes := bytes,
    storage_mb := storage_mb
  );

  if coalesce((v_check ->> 'ok')::boolean, false) = false then
    return v_check;
  end if;

  select * into v_tenant
  from public.resolve_tenant_row(v_tenant_ref);

  if v_tenant.id is null then
    raise exception 'Tenant not found for storage increment: %', v_tenant_ref
      using errcode = 'P0002';
  end if;

  v_next_mb := round((coalesce(v_tenant.storage_used_mb, 0) + coalesce(v_increment_mb, 0))::numeric, 2);

  update public.tenants
    set storage_used_mb = v_next_mb
  where id = v_tenant.id;

  return jsonb_build_object(
    'ok', true,
    'tenant_id', v_tenant.id,
    'storage_used_mb', v_next_mb,
    'storage_limit_mb', coalesce(v_tenant.max_storage_mb, 0),
    'increment_mb', coalesce(v_increment_mb, 0)
  );
end;
$$;

create or replace function public.sync_tenant_usage_counters_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_tenant text;
  v_new_tenant text;
begin
  v_old_tenant := case when tg_op in ('UPDATE', 'DELETE') then nullif(btrim(coalesce(old.tenant_id::text, '')), '') else null end;
  v_new_tenant := case when tg_op in ('INSERT', 'UPDATE') then nullif(btrim(coalesce(new.tenant_id::text, '')), '') else null end;

  if v_old_tenant is not null then
    perform public.sync_tenant_usage_counters(v_old_tenant);
  end if;

  if v_new_tenant is not null and v_new_tenant is distinct from v_old_tenant then
    perform public.sync_tenant_usage_counters(v_new_tenant);
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists products_sync_tenant_usage_counters on public.products;
create trigger products_sync_tenant_usage_counters
  after insert or update or delete on public.products
  for each row execute function public.sync_tenant_usage_counters_trigger();

drop trigger if exists customers_sync_tenant_usage_counters on public.customers;
create trigger customers_sync_tenant_usage_counters
  after insert or update or delete on public.customers
  for each row execute function public.sync_tenant_usage_counters_trigger();

drop trigger if exists orders_sync_tenant_usage_counters on public.orders;
create trigger orders_sync_tenant_usage_counters
  after insert or update or delete on public.orders
  for each row execute function public.sync_tenant_usage_counters_trigger();

drop trigger if exists operator_members_sync_tenant_usage_counters on public.operator_members;
create trigger operator_members_sync_tenant_usage_counters
  after insert or update or delete on public.operator_members
  for each row execute function public.sync_tenant_usage_counters_trigger();

create or replace view public.v_tenant_limit_health as
with base as (
  select
    t.id,
    t.id as tenant_id,
    t.name,
    t.name as tenant_name,
    t.slug,
    t.status,
    t.billing_status,
    coalesce(t.prooflink_plan_key, 'starter') as prooflink_plan_key,
    coalesce(t.product_count, 0) as product_count,
    coalesce(t.max_products, 0) as max_products,
    coalesce(t.customer_count, 0) as customer_count,
    coalesce(t.max_customers, 0) as max_customers,
    coalesce(t.operator_seat_count, 0) as operator_seat_count,
    coalesce(t.max_operator_seats, 0) as max_operator_seats,
    coalesce(t.current_month_order_count, 0) as current_month_order_count,
    coalesce(t.max_orders_per_month, 0) as max_orders_per_month,
    coalesce(t.storage_used_mb, 0)::numeric(12,2) as storage_used_mb,
    coalesce(t.max_storage_mb, 0)::numeric(12,2) as storage_limit_mb,
    coalesce(t.growth_score, 0)::numeric(12,2) as growth_score
  from public.tenants t
),
metrics as (
  select
    b.*,
    case when b.max_products > 0 then round((b.product_count::numeric / b.max_products::numeric) * 100, 2) end as products_percent,
    case when b.max_customers > 0 then round((b.customer_count::numeric / b.max_customers::numeric) * 100, 2) end as customers_percent,
    case when b.max_operator_seats > 0 then round((b.operator_seat_count::numeric / b.max_operator_seats::numeric) * 100, 2) end as seats_percent,
    case when b.max_orders_per_month > 0 then round((b.current_month_order_count::numeric / b.max_orders_per_month::numeric) * 100, 2) end as orders_percent,
    case when b.storage_limit_mb > 0 then round((b.storage_used_mb / b.storage_limit_mb) * 100, 2) end as storage_percent
  from base b
)
select
  m.*,
  greatest(
    coalesce(m.products_percent, 0),
    coalesce(m.customers_percent, 0),
    coalesce(m.seats_percent, 0),
    coalesce(m.orders_percent, 0),
    coalesce(m.storage_percent, 0)
  ) as max_percent_used,
  case
    when coalesce(m.storage_percent, 0) >= greatest(coalesce(m.products_percent, 0), coalesce(m.customers_percent, 0), coalesce(m.seats_percent, 0), coalesce(m.orders_percent, 0))
      then 'storage'
    when coalesce(m.orders_percent, 0) >= greatest(coalesce(m.products_percent, 0), coalesce(m.customers_percent, 0), coalesce(m.seats_percent, 0))
      then 'orders'
    when coalesce(m.seats_percent, 0) >= greatest(coalesce(m.products_percent, 0), coalesce(m.customers_percent, 0))
      then 'operator_seats'
    when coalesce(m.customers_percent, 0) >= coalesce(m.products_percent, 0)
      then 'customers'
    else 'products'
  end as pressured_resource,
  case
    when greatest(
      coalesce(m.products_percent, 0),
      coalesce(m.customers_percent, 0),
      coalesce(m.seats_percent, 0),
      coalesce(m.orders_percent, 0),
      coalesce(m.storage_percent, 0)
    ) >= 100 then true
    else false
  end as is_blocked,
  case
    when greatest(
      coalesce(m.products_percent, 0),
      coalesce(m.customers_percent, 0),
      coalesce(m.seats_percent, 0),
      coalesce(m.orders_percent, 0),
      coalesce(m.storage_percent, 0)
    ) >= 80
    and greatest(
      coalesce(m.products_percent, 0),
      coalesce(m.customers_percent, 0),
      coalesce(m.seats_percent, 0),
      coalesce(m.orders_percent, 0),
      coalesce(m.storage_percent, 0)
    ) < 100 then true
    else false
  end as is_warning,
  case
    when greatest(
      coalesce(m.products_percent, 0),
      coalesce(m.customers_percent, 0),
      coalesce(m.seats_percent, 0),
      coalesce(m.orders_percent, 0),
      coalesce(m.storage_percent, 0)
    ) >= 100 and coalesce(m.prooflink_plan_key, 'starter') = 'starter' then 'growth'
    when greatest(
      coalesce(m.products_percent, 0),
      coalesce(m.customers_percent, 0),
      coalesce(m.seats_percent, 0),
      coalesce(m.orders_percent, 0)
    ) >= 80 and coalesce(m.prooflink_plan_key, 'starter') = 'starter' then 'growth'
    when coalesce(m.storage_percent, 0) >= 80 then 'enterprise'
    else null
  end as recommended_plan_key
from metrics m;


-- ── 15. Platform admin operator seed ────────────────────────────────────────

insert into public.operators (email, name, role, tenant_id)
values ('christopher@prooflink.co', 'Christopher', 'platform_admin', null)
on conflict (email) do update set role = 'platform_admin', updated_at = now();


-- ── 16. Verify — shows every table and column count ─────────────────────────

select
  t.table_name,
  count(c.column_name) as column_count
from information_schema.tables t
join information_schema.columns c
  on c.table_name = t.table_name
  and c.table_schema = 'public'
where t.table_schema = 'public'
  and t.table_type = 'BASE TABLE'
group by t.table_name
order by t.table_name;


-- ── 17. profiles table ───────────────────────────────────────────────────────
-- Used by evaluate-onboarding.js and admin-update-tenant-conduct.js
-- to verify admin role on certain endpoints.
-- Maps auth.users.id → role. Platform admin role is set here.

create table if not exists public.profiles (
  id         uuid        primary key references auth.users(id) on delete cascade,
  role       text        not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_check
    check (role in ('user', 'operator', 'admin', 'platform_admin'))
);

alter table public.profiles enable row level security;

do $$ begin
  create policy "Service role full access on profiles"
    on public.profiles for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Users can read their own profile"
    on public.profiles for select to authenticated
    using (id = auth.uid());
exception when duplicate_object then null;
end $$;

-- Auto-create a profile row when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── 18. onboarding_requests view ─────────────────────────────────────────────
-- evaluate-onboarding.js uses the old table name 'onboarding_requests'.
-- This view makes it work without changing any code.

create or replace view public.onboarding_requests as
  select * from public.tenant_onboarding_requests;

-- Grant access so the function can query through it
grant select, update on public.onboarding_requests to service_role, authenticated;


-- ── 19. blog_comments table ──────────────────────────────────────────────────

create table if not exists public.blog_comments (
  id           uuid        primary key default gen_random_uuid(),
  article_slug text        not null,
  name         text        not null,
  email        text        not null,
  comment      text        not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_blog_comments_slug on public.blog_comments (article_slug, created_at desc);

alter table public.blog_comments enable row level security;

do $$ begin
  create policy "Service role full access on blog_comments"
    on public.blog_comments for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

comment on table public.blog_comments is 'Public blog article comments. Export email column for outreach.';


-- ── 20. blog_subscribers table ───────────────────────────────────────────────

create table if not exists public.blog_subscribers (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null unique,
  name       text,
  source     text,
  created_at timestamptz not null default now()
);

create index if not exists idx_blog_subscribers_created on public.blog_subscribers (created_at desc);

alter table public.blog_subscribers enable row level security;

do $$ begin
  create policy "Service role full access on blog_subscribers"
    on public.blog_subscribers for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

comment on table public.blog_subscribers is 'Blog email subscribers. Export email + name for newsletter use.';

-- Customer account locations / buildings support

alter table public.customers
  add column if not exists company_name text;

create table if not exists public.customer_locations (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     text        not null,
  operator_id   uuid        not null,
  customer_id   uuid        not null references public.customers(id) on delete cascade,
  site_name     text        not null,
  site_code     text,
  contact_name  text,
  contact_phone text,
  contact_email text,
  address_line1 text,
  city          text,
  state         text,
  zip           text,
  access_notes  text,
  notes         text,
  is_primary    boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.leads
  add column if not exists customer_location_id uuid references public.customer_locations(id) on delete set null;

alter table public.bids
  add column if not exists customer_location_id uuid references public.customer_locations(id) on delete set null;

alter table public.orders
  add column if not exists customer_location_id uuid references public.customer_locations(id) on delete set null;

alter table public.jobs
  add column if not exists customer_location_id uuid references public.customer_locations(id) on delete set null;

alter table public.bookings
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists customer_location_id uuid references public.customer_locations(id) on delete set null;

create index if not exists idx_customer_locations_tenant_operator
  on public.customer_locations (tenant_id, operator_id, customer_id, updated_at desc);
create index if not exists idx_customer_locations_customer
  on public.customer_locations (customer_id, updated_at desc);
create unique index if not exists uq_customer_locations_primary_per_customer
  on public.customer_locations (customer_id)
  where is_primary = true;
create index if not exists idx_leads_customer_location
  on public.leads (tenant_id, customer_id, customer_location_id, updated_at desc);
create index if not exists idx_bids_customer_location
  on public.bids (tenant_id, customer_id, customer_location_id, updated_at desc);
create index if not exists idx_orders_customer_location
  on public.orders (tenant_id, customer_id, customer_location_id, updated_at desc);
create index if not exists idx_jobs_customer_location
  on public.jobs (tenant_id, customer_id, customer_location_id, scheduled_date desc);
create index if not exists idx_bookings_customer_location
  on public.bookings (tenant_id, customer_id, customer_location_id, starts_at desc);

alter table public.customer_locations enable row level security;

do $$ begin
  create policy "Service role full access on customer_locations"
    on public.customer_locations for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  drop policy if exists customer_locations_operator_all on public.customer_locations;
  create policy customer_locations_operator_all on public.customer_locations for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

drop trigger if exists customer_locations_updated_at_trigger on public.customer_locations;
create trigger customer_locations_updated_at_trigger
  before update on public.customer_locations
  for each row execute function public.set_updated_at();

drop trigger if exists customer_locations_operator_tenant_pair_guard on public.customer_locations;
create trigger customer_locations_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.customer_locations
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

revoke all on table public.customer_locations from anon;
grant select, insert, update, delete on table public.customer_locations to authenticated, service_role;
