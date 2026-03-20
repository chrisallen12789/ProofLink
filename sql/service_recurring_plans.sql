-- ============================================================================
-- ProofLink recurring service plans
-- Run after sql/catchup_run_this.sql and sql/service_workflow_phase1.sql
-- Adds first-class recurring service plans plus order/job generation.
-- ============================================================================

alter table public.orders
  add column if not exists service_plan_id uuid,
  add column if not exists service_address text,
  add column if not exists schedule_window text;

alter table public.jobs
  add column if not exists service_plan_id uuid;

create table if not exists public.service_plans (
  id                      uuid        primary key default gen_random_uuid(),
  tenant_id               text        not null,
  operator_id             uuid        not null,
  customer_id             uuid        not null references public.customers(id) on delete cascade,
  source_order_id         uuid        references public.orders(id) on delete set null,
  source_job_id           uuid        references public.jobs(id) on delete set null,
  status                  text        not null default 'draft',
  title                   text,
  cadence                 text        not null default 'monthly',
  custom_interval_days    integer,
  next_run_on             date,
  last_run_on             date,
  auto_create_job         boolean     not null default true,
  service_address         text,
  schedule_window         text,
  summary                 text,
  notes                   text,
  line_items              jsonb       not null default '[]'::jsonb,
  amount_cents            integer     not null default 0,
  deposit_required_cents  integer     not null default 0,
  last_generated_order_id uuid,
  last_generated_job_id   uuid,
  metadata                jsonb       not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint service_plans_status_check
    check (status in ('draft', 'active', 'paused', 'cancelled')),
  constraint service_plans_cadence_check
    check (cadence in ('weekly', 'biweekly', 'monthly', 'quarterly', 'custom_days')),
  constraint service_plans_custom_interval_days_check
    check (cadence <> 'custom_days' or custom_interval_days is not null and custom_interval_days >= 7),
  constraint service_plans_line_items_array_check
    check (jsonb_typeof(line_items) = 'array')
);

create index if not exists idx_service_plans_tenant_operator
  on public.service_plans (tenant_id, operator_id, updated_at desc);
create index if not exists idx_service_plans_tenant_status
  on public.service_plans (tenant_id, status, next_run_on, updated_at desc);
create index if not exists idx_service_plans_customer
  on public.service_plans (customer_id, updated_at desc);
create index if not exists idx_orders_tenant_service_plan
  on public.orders (tenant_id, service_plan_id, scheduled_date desc);
create index if not exists idx_jobs_tenant_service_plan
  on public.jobs (tenant_id, service_plan_id, scheduled_date desc);
create unique index if not exists idx_orders_service_plan_scheduled_date_unique
  on public.orders (service_plan_id, scheduled_date)
  where service_plan_id is not null;

alter table public.service_plans enable row level security;

do $$ begin
  create policy "Service role full access on service_plans"
    on public.service_plans for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  drop policy if exists service_plans_operator_all on public.service_plans;
  create policy service_plans_operator_all on public.service_plans for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

revoke all on table public.service_plans from anon;
grant select, insert, update, delete on table public.service_plans to authenticated, service_role;

do $$ begin
  alter table public.orders
    add constraint orders_service_plan_id_fkey
    foreign key (service_plan_id) references public.service_plans(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.jobs
    add constraint jobs_service_plan_id_fkey
    foreign key (service_plan_id) references public.service_plans(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.service_plans
    add constraint service_plans_last_generated_order_id_fkey
    foreign key (last_generated_order_id) references public.orders(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.service_plans
    add constraint service_plans_last_generated_job_id_fkey
    foreign key (last_generated_job_id) references public.jobs(id) on delete set null;
exception when duplicate_object then null;
end $$;

drop trigger if exists service_plans_updated_at_trigger on public.service_plans;
create trigger service_plans_updated_at_trigger
  before update on public.service_plans
  for each row execute function public.set_updated_at();

create or replace function public.enforce_service_plan_relationships()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_customer_id uuid;
begin
  if not public.ensure_record_tenant('public.customers'::regclass, new.customer_id, new.tenant_id) then
    raise exception 'service_plans customer must belong to the same tenant';
  end if;

  if not public.ensure_record_tenant('public.orders'::regclass, new.source_order_id, new.tenant_id) then
    raise exception 'service_plans source_order must belong to the same tenant';
  end if;

  if not public.ensure_record_tenant('public.jobs'::regclass, new.source_job_id, new.tenant_id) then
    raise exception 'service_plans source_job must belong to the same tenant';
  end if;

  if new.status = 'active' and new.next_run_on is null then
    raise exception 'active service plans require next_run_on';
  end if;

  if new.source_order_id is not null then
    select customer_id
      into v_order_customer_id
      from public.orders
     where id = new.source_order_id;

    if v_order_customer_id is not null and new.customer_id is distinct from v_order_customer_id then
      raise exception 'service_plans customer_id must match the source order customer';
    end if;
  end if;

  if nullif(btrim(coalesce(new.title, '')), '') is null then
    new.title := 'Recurring service';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_service_plan_relationships() from public;
grant execute on function public.enforce_service_plan_relationships() to authenticated, service_role;

drop trigger if exists service_plans_relationship_guard on public.service_plans;
create trigger service_plans_relationship_guard
  before insert or update on public.service_plans
  for each row execute function public.enforce_service_plan_relationships();

create or replace function public.advance_service_plan_next_run_on(p_current date, p_cadence text, p_custom_interval_days integer default null)
returns date
language plpgsql
immutable
as $$
begin
  case lower(coalesce(p_cadence, 'monthly'))
    when 'weekly' then
      return p_current + interval '7 day';
    when 'biweekly' then
      return p_current + interval '14 day';
    when 'quarterly' then
      return p_current + interval '3 month';
    when 'custom_days' then
      return p_current + make_interval(days => greatest(coalesce(p_custom_interval_days, 30), 1));
    else
      return p_current + interval '1 month';
  end case;
end;
$$;

revoke all on function public.advance_service_plan_next_run_on(date, text, integer) from public;
grant execute on function public.advance_service_plan_next_run_on(date, text, integer) to authenticated, service_role;

create or replace function public.create_order_from_service_plan(p_plan_id uuid, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.service_plans%rowtype;
  v_customer public.customers%rowtype;
  v_source_order public.orders%rowtype;
  v_source_job public.jobs%rowtype;
  v_order_id uuid;
  v_job_id uuid;
  v_scheduled_date date;
  v_items jsonb := '[]'::jsonb;
  v_item_count integer := 0;
  v_unpriced_count integer := 0;
  v_amount integer := 0;
begin
  select *
    into v_plan
    from public.service_plans
   where id = p_plan_id;

  if v_plan.id is null then
    raise exception 'create_order_from_service_plan: plan not found';
  end if;

  if not public.current_user_can_access_operator_record(v_plan.operator_id, v_plan.tenant_id) then
    raise exception 'create_order_from_service_plan: forbidden';
  end if;

  if lower(coalesce(v_plan.status, '')) <> 'active' and not p_force then
    raise exception 'create_order_from_service_plan: plan must be active before generating work';
  end if;

  v_scheduled_date := coalesce(v_plan.next_run_on, current_date);
  if v_scheduled_date is null then
    raise exception 'create_order_from_service_plan: next_run_on is required';
  end if;

  select *
    into v_customer
    from public.customers
   where id = v_plan.customer_id;

  if v_customer.id is null then
    raise exception 'create_order_from_service_plan: customer not found';
  end if;

  if v_plan.source_order_id is not null then
    select *
      into v_source_order
      from public.orders
     where id = v_plan.source_order_id;
  end if;

  if v_plan.source_job_id is not null then
    select *
      into v_source_job
      from public.jobs
     where id = v_plan.source_job_id;
  end if;

  select id
    into v_order_id
    from public.orders
   where service_plan_id = v_plan.id
     and scheduled_date = v_scheduled_date
   order by created_at desc
   limit 1;

  if v_order_id is not null then
    return jsonb_build_object(
      'ok', true,
      'order_id', v_order_id,
      'job_id', (select primary_job_id from public.orders where id = v_order_id),
      'existing', true
    );
  end if;

  v_items := case
    when jsonb_typeof(v_plan.line_items) = 'array' and jsonb_array_length(v_plan.line_items) > 0 then v_plan.line_items
    when jsonb_typeof(v_source_order.items) = 'array' and jsonb_array_length(v_source_order.items) > 0 then v_source_order.items
    else jsonb_build_array(jsonb_build_object(
      'name', coalesce(nullif(btrim(coalesce(v_plan.title, '')), ''), 'Recurring service'),
      'description', coalesce(v_plan.summary, ''),
      'quantity', 1,
      'unit', 'visit',
      'kind', 'base',
      'unitPriceCents', greatest(coalesce(v_plan.amount_cents, 0), 0),
      'totalCents', greatest(coalesce(v_plan.amount_cents, 0), 0)
    ))
  end;

  select coalesce(sum(greatest(coalesce((item->>'totalCents')::integer, (item->>'total_cents')::integer, 0), 0)), 0),
         count(*),
         count(*) filter (
           where greatest(coalesce((item->>'unitPriceCents')::integer, (item->>'unit_price_cents')::integer, 0), 0) = 0
         )
    into v_amount, v_item_count, v_unpriced_count
    from jsonb_array_elements(v_items) item;

  v_amount := greatest(v_amount, coalesce(v_plan.amount_cents, 0), 0);

  insert into public.orders (
    tenant_id,
    operator_id,
    customer_id,
    bid_id,
    service_plan_id,
    status,
    fulfillment,
    scheduled_date,
    scheduled_time,
    service_address,
    schedule_window,
    items,
    subtotal_cents,
    total_cents,
    estimated_total_cents,
    item_count,
    unpriced_count,
    cart_summary,
    notes,
    customer_name,
    email,
    phone,
    preferred_contact,
    payment_due_date,
    deposit_required_cents,
    source_type,
    source_ref,
    booked_at,
    created_at,
    updated_at
  )
  values (
    v_plan.tenant_id,
    v_plan.operator_id,
    v_plan.customer_id,
    v_source_order.bid_id,
    v_plan.id,
    'confirmed',
    'service',
    v_scheduled_date,
    null,
    coalesce(nullif(btrim(coalesce(v_plan.service_address, '')), ''), v_source_job.service_address, v_source_order.service_address),
    nullif(btrim(coalesce(v_plan.schedule_window, '')), ''),
    v_items,
    v_amount,
    v_amount,
    v_amount,
    greatest(v_item_count, 1),
    case when v_amount > 0 then v_unpriced_count else greatest(v_item_count, 1) end,
    coalesce(nullif(btrim(coalesce(v_plan.summary, '')), ''), nullif(btrim(coalesce(v_plan.title, '')), ''), 'Recurring service'),
    coalesce(nullif(btrim(coalesce(v_plan.notes, '')), ''), nullif(btrim(coalesce(v_source_order.notes, '')), '')),
    v_customer.name,
    v_customer.email,
    v_customer.phone,
    coalesce(v_customer.preferred_contact, 'email'),
    v_scheduled_date,
    greatest(coalesce(v_plan.deposit_required_cents, 0), 0),
    'service_plan',
    v_plan.id::text,
    now(),
    now(),
    now()
  )
  returning id into v_order_id;

  if v_plan.auto_create_job then
    insert into public.jobs (
      tenant_id,
      operator_id,
      service_plan_id,
      order_id,
      customer_id,
      bid_id,
      status,
      title,
      service_address,
      scheduled_date,
      schedule_window,
      summary,
      notes,
      payment_state,
      amount_paid_cents,
      amount_due_cents,
      created_at,
      updated_at
    )
    values (
      v_plan.tenant_id,
      v_plan.operator_id,
      v_plan.id,
      v_order_id,
      v_plan.customer_id,
      v_source_order.bid_id,
      'scheduled',
      coalesce(nullif(btrim(coalesce(v_plan.title, '')), ''), 'Recurring service'),
      coalesce(nullif(btrim(coalesce(v_plan.service_address, '')), ''), v_source_job.service_address, v_source_order.service_address),
      v_scheduled_date,
      nullif(btrim(coalesce(v_plan.schedule_window, '')), ''),
      coalesce(nullif(btrim(coalesce(v_plan.summary, '')), ''), nullif(btrim(coalesce(v_plan.title, '')), ''), 'Recurring service'),
      nullif(btrim(coalesce(v_plan.notes, '')), ''),
      'unpaid',
      0,
      v_amount,
      now(),
      now()
    )
    returning id into v_job_id;

    update public.orders
       set primary_job_id = v_job_id,
           updated_at = now()
     where id = v_order_id;
  end if;

  update public.service_plans
     set last_run_on = v_scheduled_date,
         last_generated_order_id = v_order_id,
         last_generated_job_id = v_job_id,
         next_run_on = public.advance_service_plan_next_run_on(v_scheduled_date, v_plan.cadence, v_plan.custom_interval_days),
         updated_at = now()
   where id = v_plan.id;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'job_id', v_job_id,
    'existing', false
  );
end;
$$;

revoke all on function public.create_order_from_service_plan(uuid, boolean) from public;
grant execute on function public.create_order_from_service_plan(uuid, boolean) to authenticated, service_role;

create or replace function public.generate_due_service_plans(p_tenant_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.service_plans%rowtype;
  v_result jsonb;
  v_created_count integer := 0;
  v_existing_count integer := 0;
begin
  for v_plan in
    select *
      from public.service_plans
     where status = 'active'
       and next_run_on is not null
       and next_run_on <= current_date
       and (p_tenant_id is null or tenant_id = p_tenant_id)
     order by next_run_on asc, created_at asc
  loop
    if public.current_user_can_access_operator_record(v_plan.operator_id, v_plan.tenant_id) then
      v_result := public.create_order_from_service_plan(v_plan.id, false);
      if coalesce((v_result->>'existing')::boolean, false) then
        v_existing_count := v_existing_count + 1;
      else
        v_created_count := v_created_count + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'created_count', v_created_count,
    'existing_count', v_existing_count
  );
end;
$$;

revoke all on function public.generate_due_service_plans(text) from public;
grant execute on function public.generate_due_service_plans(text) to authenticated, service_role;
