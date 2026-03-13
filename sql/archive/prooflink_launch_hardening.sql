-- ProofLink multi-tenant launch hardening
-- Run in the DEV Supabase project first.

begin;

-- Status lifecycle for database-backed storefront orders.
alter table if exists public.orders
  drop constraint if exists orders_status_allowed;

alter table if exists public.orders
  add constraint orders_status_allowed
  check (status is null or lower(status) in ('new', 'confirmed', 'fulfilled', 'cancelled', 'paid', 'completed'));

-- Prevent empty items arrays at the table level.
alter table if exists public.orders
  drop constraint if exists orders_items_not_empty;

alter table if exists public.orders
  add constraint orders_items_not_empty
  check (items is not null and jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0);

-- Customer uniqueness per tenant by email when email is present.
create unique index if not exists uq_customers_tenant_email_lower
  on public.customers (tenant_id, lower(email))
  where email is not null and btrim(email) <> '';

-- Performance indexes for operator reads.
create index if not exists idx_orders_tenant_status_created
  on public.orders (tenant_id, status, created_at desc);

create index if not exists idx_orders_customer_created
  on public.orders (customer_id, created_at desc);

-- Transitional RLS policies for anon storefront inserts through RPC and scoped operator reads.
alter table if exists public.orders enable row level security;
alter table if exists public.customers enable row level security;

-- Leave write authority to service-role / security definer paths. Operator reads remain authenticated-only.
drop policy if exists orders_authenticated_read on public.orders;
create policy orders_authenticated_read on public.orders
  for select
  to authenticated
  using (true);

drop policy if exists customers_authenticated_read on public.customers;
create policy customers_authenticated_read on public.customers
  for select
  to authenticated
  using (true);

commit;
