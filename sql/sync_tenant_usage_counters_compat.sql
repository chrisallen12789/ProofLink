-- Hosted compatibility helper for environments that already have the main
-- schema but still carry the ambiguous sync_tenant_usage_counters function.

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

notify pgrst, 'reload schema';
