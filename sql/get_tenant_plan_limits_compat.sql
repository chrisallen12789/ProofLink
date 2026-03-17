-- Hosted compatibility helper for older environments that already have most
-- governance objects but still need the final get_tenant_plan_limits overloads.

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
