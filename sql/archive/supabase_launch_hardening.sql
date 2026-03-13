-- CottageLink launch hardening for database-backed storefront orders.
-- Run in the DEV Supabase project first.

begin;

alter table if exists public.orders add column if not exists tenant_id text;
alter table if exists public.orders add column if not exists operator_id uuid;
alter table if exists public.orders add column if not exists customer_id uuid;
alter table if exists public.orders add column if not exists customer_name text;
alter table if exists public.orders add column if not exists email text;
alter table if exists public.orders add column if not exists phone text;
alter table if exists public.orders add column if not exists preferred_contact text;
alter table if exists public.orders add column if not exists fulfillment text;
alter table if exists public.orders add column if not exists scheduled_date date;
alter table if exists public.orders add column if not exists scheduled_time text;
alter table if exists public.orders add column if not exists items jsonb not null default '[]'::jsonb;
alter table if exists public.orders add column if not exists subtotal_cents integer not null default 0;
alter table if exists public.orders add column if not exists delivery_fee_cents integer not null default 0;
alter table if exists public.orders add column if not exists total_cents integer not null default 0;
alter table if exists public.orders add column if not exists estimated_total_cents integer not null default 0;
alter table if exists public.orders add column if not exists item_count integer not null default 0;
alter table if exists public.orders add column if not exists unpriced_count integer not null default 0;
alter table if exists public.orders add column if not exists cart_summary text;
alter table if exists public.orders add column if not exists notes text;
alter table if exists public.orders add column if not exists source_type text;
alter table if exists public.orders add column if not exists source_ref text;
alter table if exists public.orders add column if not exists created_at timestamptz not null default now();
alter table if exists public.orders add column if not exists updated_at timestamptz not null default now();

alter table if exists public.customers add column if not exists tenant_id text;
alter table if exists public.customers add column if not exists operator_id uuid;
alter table if exists public.customers add column if not exists name text;
alter table if exists public.customers add column if not exists email text;
alter table if exists public.customers add column if not exists phone text;
alter table if exists public.customers add column if not exists preferred_contact text;
alter table if exists public.customers add column if not exists notes text;
alter table if exists public.customers add column if not exists lifetime_value_cents integer not null default 0;
alter table if exists public.customers add column if not exists order_count integer not null default 0;
alter table if exists public.customers add column if not exists last_contact_at timestamptz;
alter table if exists public.customers add column if not exists created_at timestamptz not null default now();
alter table if exists public.customers add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_orders_tenant_operator_created on public.orders (tenant_id, operator_id, created_at desc);
create index if not exists idx_orders_tenant_email on public.orders (tenant_id, email);
create index if not exists idx_customers_tenant_operator_updated on public.customers (tenant_id, operator_id, updated_at desc);
create index if not exists idx_customers_tenant_email on public.customers (tenant_id, lower(email));
create unique index if not exists uq_availability_tenant_operator on public.availability (tenant_id, operator_id);

create or replace function public.submit_storefront_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id text := nullif(trim(coalesce(payload->>'tenant_id', '')), '');
  v_tenant_slug text := nullif(trim(coalesce(payload->>'tenant_slug', '')), '');
  v_operator_id uuid;
  v_customer_id uuid;
  v_order_id uuid;
  v_customer_name text := nullif(trim(coalesce(payload->>'customer_name', '')), '');
  v_email text := lower(nullif(trim(coalesce(payload->>'email', '')), ''));
  v_phone text := nullif(trim(coalesce(payload->>'phone', '')), '');
  v_preferred_contact text := coalesce(nullif(trim(payload->>'preferred_contact'), ''), 'email');
  v_status text := coalesce(nullif(trim(payload->>'status'), ''), 'new');
  v_fulfillment text := coalesce(nullif(trim(payload->>'fulfillment'), ''), 'pickup');
  v_scheduled_date date := nullif(payload->>'scheduled_date', '')::date;
  v_scheduled_time text := nullif(trim(coalesce(payload->>'scheduled_time', '')), '');
  v_items jsonb := coalesce(payload->'items', '[]'::jsonb);
  v_subtotal_cents integer := greatest(coalesce((payload->>'subtotal_cents')::integer, 0), 0);
  v_delivery_fee_cents integer := greatest(coalesce((payload->>'delivery_fee_cents')::integer, 0), 0);
  v_total_cents integer := greatest(coalesce((payload->>'total_cents')::integer, 0), 0);
  v_estimated_total_cents integer := greatest(coalesce((payload->>'estimated_total_cents')::integer, v_total_cents), 0);
  v_item_count integer := greatest(coalesce((payload->>'item_count')::integer, jsonb_array_length(v_items)), 0);
  v_unpriced_count integer := greatest(coalesce((payload->>'unpriced_count')::integer, 0), 0);
  v_notes text := nullif(trim(coalesce(payload->>'notes', '')), '');
  v_cart_summary text := nullif(trim(coalesce(payload->>'cart_summary', '')), '');
  v_source_type text := coalesce(nullif(trim(payload->>'source_type'), ''), 'storefront');
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

  select o.id
    into v_operator_id
  from public.operators o
  where o.tenant_id = v_tenant_id
    and coalesce(o.status, 'active') = 'active'
  order by o.created_at nulls first, o.id
  limit 1;

  if v_operator_id is null then
    raise exception 'submit_storefront_order: no active operator found for tenant %', v_tenant_id;
  end if;

  select c.id
    into v_customer_id
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
       set name = v_customer_name,
           email = coalesce(v_email, email),
           phone = coalesce(v_phone, phone),
           preferred_contact = v_preferred_contact,
           notes = case when v_notes is not null then v_notes else notes end,
           lifetime_value_cents = coalesce(lifetime_value_cents, 0) + v_total_cents,
           order_count = coalesce(order_count, 0) + 1,
           last_contact_at = now(),
           updated_at = now()
     where id = v_customer_id;
  end if;

  insert into public.orders (
    tenant_id, operator_id, customer_id, status, fulfillment, scheduled_date, scheduled_time,
    items, subtotal_cents, delivery_fee_cents, total_cents, estimated_total_cents, item_count,
    unpriced_count, notes, cart_summary, customer_name, email, phone, preferred_contact,
    source_type, source_ref, created_at, updated_at
  ) values (
    v_tenant_id, v_operator_id, v_customer_id, v_status, v_fulfillment, v_scheduled_date, v_scheduled_time,
    v_items, v_subtotal_cents, v_delivery_fee_cents, v_total_cents, v_estimated_total_cents, v_item_count,
    v_unpriced_count, v_notes, v_cart_summary, v_customer_name, v_email, v_phone, v_preferred_contact,
    v_source_type, v_tenant_slug, now(), now()
  )
  returning id into v_order_id;

  update public.customers
     set lifetime_value_cents = coalesce(lifetime_value_cents, 0) + v_total_cents,
         order_count = coalesce(order_count, 0) + 1,
         last_contact_at = now(),
         updated_at = now()
   where id = v_customer_id
     and not exists (
       select 1 from public.orders o
       where o.customer_id = v_customer_id and o.id = v_order_id and o.total_cents = 0
     );

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'customer_id', v_customer_id,
    'operator_id', v_operator_id,
    'tenant_id', v_tenant_id
  );
end;
$$;

revoke all on function public.submit_storefront_order(jsonb) from public;
grant execute on function public.submit_storefront_order(jsonb) to anon, authenticated, service_role;

commit;
