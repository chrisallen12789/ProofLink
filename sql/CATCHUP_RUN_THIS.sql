-- ============================================================================
-- ProofLink — Full Catch-Up Migration
-- Run this ONE TIME in your Supabase SQL editor.
-- Safe to run: every statement uses IF NOT EXISTS or ADD COLUMN IF NOT EXISTS.
-- This covers everything missing based on your current database state.
-- ============================================================================

-- ── 1. TENANTS — add all missing columns ────────────────────────────────────

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
  add column if not exists tagline                   text;

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
  add column if not exists reviewed_at       timestamptz;

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
    using (public.operator_member_access(operator_id))
    with check (public.operator_member_access(operator_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists pricing_operator_all on public.pricing;
  create policy pricing_operator_all on public.pricing for all to authenticated
    using (public.operator_member_access(operator_id))
    with check (public.operator_member_access(operator_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists availability_operator_all on public.availability;
  create policy availability_operator_all on public.availability for all to authenticated
    using (public.operator_member_access(operator_id))
    with check (public.operator_member_access(operator_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists expenses_operator_all on public.expenses;
  create policy expenses_operator_all on public.expenses for all to authenticated
    using (public.operator_member_access(operator_id))
    with check (public.operator_member_access(operator_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists customers_operator_all on public.customers;
  create policy customers_operator_all on public.customers for all to authenticated
    using (public.operator_member_access(operator_id))
    with check (public.operator_member_access(operator_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists orders_operator_all on public.orders;
  create policy orders_operator_all on public.orders for all to authenticated
    using (public.operator_member_access(operator_id))
    with check (public.operator_member_access(operator_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists payments_operator_all on public.payments;
  create policy payments_operator_all on public.payments for all to authenticated
    using (public.operator_member_access(operator_id))
    with check (public.operator_member_access(operator_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists customer_interactions_operator_all on public.customer_interactions;
  create policy customer_interactions_operator_all on public.customer_interactions for all to authenticated
    using (public.operator_member_access(operator_id))
    with check (public.operator_member_access(operator_id));
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
  v_status               text    := coalesce(nullif(trim(payload->>'status'), ''), 'new');
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
grant execute on function public.submit_storefront_order(jsonb) to anon, authenticated, service_role;


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
