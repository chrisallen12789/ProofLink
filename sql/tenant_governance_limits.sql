-- ProofLink
-- Plan/storage governance SQL objects referenced by the app.
-- Apply to existing projects after the core schema is in place.

alter table public.tenants
  add column if not exists product_count integer not null default 0,
  add column if not exists max_products integer not null default 10,
  add column if not exists customer_count integer not null default 0,
  add column if not exists max_customers integer not null default 50,
  add column if not exists operator_seat_count integer not null default 0,
  add column if not exists max_operator_seats integer not null default 1,
  add column if not exists current_month_order_count integer not null default 0,
  add column if not exists max_orders_per_month integer not null default 100,
  add column if not exists storage_used_mb numeric(12,2) not null default 0,
  add column if not exists max_storage_mb numeric(12,2) not null default 100,
  add column if not exists growth_score numeric(12,2) not null default 0;

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
  from public.products
  where tenant_id = v_tenant.id::text;

  select count(*)::integer into v_customer_count
  from public.customers
  where tenant_id = v_tenant.id::text;

  select count(*)::integer into v_operator_count
  from public.operator_members
  where tenant_id = v_tenant.id;

  select count(*)::integer into v_order_count
  from public.orders
  where tenant_id = v_tenant.id::text
    and created_at >= date_trunc('month', timezone('utc', now()));

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
