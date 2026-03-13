-- CottageLink Phase 3.5 tenant hardening
-- This is intentionally incremental. It prepares backend tenant scoping without forcing an immediate rewrite.
-- Review against your current schema before running in production.

-- 1) Add tenant_id to tenant-owned tables.
alter table if exists public.products add column if not exists tenant_id text;
alter table if exists public.pricing add column if not exists tenant_id text;
alter table if exists public.expenses add column if not exists tenant_id text;
alter table if exists public.availability add column if not exists tenant_id text;
alter table if exists public.customers add column if not exists tenant_id text;
alter table if exists public.customer_interactions add column if not exists tenant_id text;
alter table if exists public.orders add column if not exists tenant_id text;
alter table if exists public.payments add column if not exists tenant_id text;

-- 2) Backfill the current tenant for existing Honest To Crust rows.
update public.products set tenant_id = coalesce(tenant_id, 'honest-to-crust');
update public.pricing set tenant_id = coalesce(tenant_id, 'honest-to-crust');
update public.expenses set tenant_id = coalesce(tenant_id, 'honest-to-crust');
update public.availability set tenant_id = coalesce(tenant_id, 'honest-to-crust');
update public.customers set tenant_id = coalesce(tenant_id, 'honest-to-crust');
update public.customer_interactions set tenant_id = coalesce(tenant_id, 'honest-to-crust');
update public.orders set tenant_id = coalesce(tenant_id, 'honest-to-crust');
update public.payments set tenant_id = coalesce(tenant_id, 'honest-to-crust');

-- 3) Tighten constraints after backfill.
alter table if exists public.products alter column tenant_id set not null;
alter table if exists public.pricing alter column tenant_id set not null;
alter table if exists public.expenses alter column tenant_id set not null;
alter table if exists public.availability alter column tenant_id set not null;
alter table if exists public.customers alter column tenant_id set not null;
alter table if exists public.customer_interactions alter column tenant_id set not null;
alter table if exists public.orders alter column tenant_id set not null;
alter table if exists public.payments alter column tenant_id set not null;

-- 4) Helpful compound indexes.
create index if not exists idx_products_tenant_operator on public.products (tenant_id, operator_id);
create index if not exists idx_pricing_tenant_operator on public.pricing (tenant_id, operator_id);
create index if not exists idx_expenses_tenant_operator on public.expenses (tenant_id, operator_id);
create index if not exists idx_availability_tenant_operator on public.availability (tenant_id, operator_id);
create index if not exists idx_customers_tenant_operator on public.customers (tenant_id, operator_id);
create index if not exists idx_orders_tenant_operator on public.orders (tenant_id, operator_id);
create index if not exists idx_payments_tenant_operator on public.payments (tenant_id, operator_id);

-- 5) Make uniqueness tenant-aware where needed.
create unique index if not exists uq_availability_tenant_operator on public.availability (tenant_id, operator_id);

-- 6) Example RLS pattern. Tailor this to your auth model.
-- alter table public.products enable row level security;
-- create policy products_tenant_scope_select on public.products
--   for select using (tenant_id = current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id');
-- create policy products_tenant_scope_write on public.products
--   for all using (tenant_id = current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')
--   with check (tenant_id = current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id');

-- 7) Update get_public_catalog() to accept a tenant filter before enabling operator-side tenant enforcement.
-- Example signature direction:
--   get_public_catalog(tenant_slug text, include_unavailable boolean default false)
