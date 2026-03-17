create or replace function public.get_tenant_plan_limits(p_tenant_ref text)
returns table (
  tenant_id text,
  prooflink_plan_key text,
  max_products integer,
  products_limit integer,
  max_customers integer,
  customers_limit integer,
  max_orders_per_month integer,
  orders_limit integer,
  monthly_orders_limit integer,
  max_operator_seats integer,
  seats_limit integer,
  max_storage_mb numeric,
  storage_mb_limit numeric
)
language sql
stable
set search_path = public
as $$
  select
    coalesce(t.id::text, t.slug) as tenant_id,
    coalesce(t.prooflink_plan_key, 'starter') as prooflink_plan_key,
    coalesce(t.max_products, 10) as max_products,
    coalesce(t.max_products, 10) as products_limit,
    coalesce(t.max_customers, 50) as max_customers,
    coalesce(t.max_customers, 50) as customers_limit,
    coalesce(t.max_orders_per_month, 100) as max_orders_per_month,
    coalesce(t.max_orders_per_month, 100) as orders_limit,
    coalesce(t.max_orders_per_month, 100) as monthly_orders_limit,
    coalesce(t.max_operator_seats, 1) as max_operator_seats,
    coalesce(t.max_operator_seats, 1) as seats_limit,
    coalesce(t.max_storage_mb, 100)::numeric as max_storage_mb,
    coalesce(t.max_storage_mb, 100)::numeric as storage_mb_limit
  from public.tenants t
  where t.id::text = nullif(btrim(p_tenant_ref), '')
     or t.slug = nullif(btrim(p_tenant_ref), '')
  limit 1;
$$;
