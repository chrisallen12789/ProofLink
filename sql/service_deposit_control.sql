-- ============================================================================
-- ProofLink service deposit control
-- Run after sql/catchup_run_this.sql and sql/service_workflow_phase1.sql.
-- If recurring plans are enabled, run this after sql/service_recurring_plans.sql too.
-- Adds deposit policy, override controls, and enforcement around booking/jobs.
-- ============================================================================

alter table public.orders
  add column if not exists deposit_policy text not null default 'optional',
  add column if not exists deposit_due_date date,
  add column if not exists deposit_override_reason text,
  add column if not exists deposit_override_at timestamptz,
  add column if not exists deposit_override_by uuid;

do $$ begin
  alter table public.orders
    drop constraint if exists orders_deposit_policy_check;
exception when others then null;
end $$;

alter table public.orders
  add constraint orders_deposit_policy_check
  check (deposit_policy in ('optional','required_before_booking','required_before_job'));

do $$ begin
  alter table public.orders
    add constraint orders_deposit_override_by_fkey
    foreign key (deposit_override_by) references public.operators(id) on delete set null;
exception when duplicate_object then null;
end $$;

create index if not exists idx_orders_tenant_deposit_policy
  on public.orders (tenant_id, deposit_policy, deposit_due_date, updated_at desc);

create or replace function public.enforce_order_deposit_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy text;
  v_required bigint;
  v_paid bigint;
  v_gap bigint;
  v_override text;
  v_old_booked boolean := false;
  v_new_booked boolean := false;
  v_booking_transition boolean := false;
begin
  v_required := greatest(coalesce(new.deposit_required_cents, 0), 0);
  v_paid := greatest(coalesce(new.deposit_paid_cents, coalesce(new.amount_paid_cents, 0)), 0);
  v_gap := greatest(v_required - v_paid, 0);
  v_policy := lower(coalesce(new.deposit_policy, 'optional'));
  if v_policy not in ('optional','required_before_booking','required_before_job') then
    v_policy := 'optional';
  end if;
  new.deposit_policy := case when v_required <= 0 then 'optional' else v_policy end;

  new.deposit_override_reason := nullif(btrim(coalesce(new.deposit_override_reason, '')), '');
  if new.deposit_override_reason is not null then
    new.deposit_override_at := coalesce(new.deposit_override_at, now());
    new.deposit_override_by := coalesce(new.deposit_override_by, new.operator_id);
  else
    new.deposit_override_at := null;
    new.deposit_override_by := null;
  end if;

  if v_required > 0 and new.deposit_policy <> 'optional' and new.deposit_due_date is null then
    new.deposit_due_date := coalesce(new.scheduled_date, new.payment_due_date, current_date);
  elsif v_required <= 0 or new.deposit_policy = 'optional' then
    new.deposit_due_date := null;
  end if;

  if tg_op = 'INSERT' then
    v_new_booked := lower(coalesce(new.status, '')) in ('confirmed','fulfilled','completed','paid')
      or new.booked_at is not null
      or new.primary_job_id is not null;
    v_booking_transition := v_new_booked;
  else
    v_old_booked := lower(coalesce(old.status, '')) in ('confirmed','fulfilled','completed','paid')
      or old.booked_at is not null
      or old.primary_job_id is not null;
    v_new_booked := lower(coalesce(new.status, '')) in ('confirmed','fulfilled','completed','paid')
      or new.booked_at is not null
      or new.primary_job_id is not null;
    v_booking_transition := (not v_old_booked and v_new_booked)
      or (old.primary_job_id is null and new.primary_job_id is not null);
  end if;

  if new.deposit_policy = 'required_before_booking'
     and v_gap > 0
     and new.deposit_override_reason is null
     and v_booking_transition then
    raise exception 'Deposit must be collected or explicitly overridden before booking this order';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_order_deposit_policy() from public;
grant execute on function public.enforce_order_deposit_policy() to authenticated, service_role;

drop trigger if exists orders_deposit_policy_guard on public.orders;
create trigger orders_deposit_policy_guard
  before insert or update of status, booked_at, primary_job_id, deposit_required_cents, deposit_paid_cents, deposit_policy, deposit_due_date, deposit_override_reason, deposit_override_at, deposit_override_by
  on public.orders
  for each row execute function public.enforce_order_deposit_policy();

create or replace function public.enforce_job_deposit_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_gap bigint;
begin
  if new.order_id is null then
    return new;
  end if;

  select *
    into v_order
    from public.orders
   where id = new.order_id;

  if v_order.id is null then
    raise exception 'Job must link to a valid order';
  end if;

  v_gap := greatest(greatest(coalesce(v_order.deposit_required_cents, 0), 0) - greatest(coalesce(v_order.deposit_paid_cents, coalesce(v_order.amount_paid_cents, 0)), 0), 0);

  if lower(coalesce(v_order.deposit_policy, 'optional')) in ('required_before_booking','required_before_job')
     and v_gap > 0
     and nullif(btrim(coalesce(v_order.deposit_override_reason, '')), '') is null
     and lower(coalesce(new.status, 'scheduled')) <> 'cancelled' then
    raise exception 'Deposit must be collected or explicitly overridden before creating this job';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_job_deposit_policy() from public;
grant execute on function public.enforce_job_deposit_policy() to authenticated, service_role;

drop trigger if exists jobs_deposit_policy_guard on public.jobs;
create trigger jobs_deposit_policy_guard
  before insert or update of order_id on public.jobs
  for each row execute function public.enforce_job_deposit_policy();

create or replace function public.create_order_from_bid(p_bid_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bid record;
  v_customer record;
  v_order_id uuid;
  v_status text;
  v_deposit_required integer := 0;
begin
  select *
    into v_bid
    from public.bids
   where id = p_bid_id;

  if v_bid.id is null then
    raise exception 'create_order_from_bid: bid not found';
  end if;

  if not public.current_user_can_access_operator_record(v_bid.operator_id, v_bid.tenant_id) then
    raise exception 'create_order_from_bid: forbidden';
  end if;

  if v_bid.customer_id is null then
    raise exception 'create_order_from_bid: customer_id is required';
  end if;

  select *
    into v_customer
    from public.customers
   where id = v_bid.customer_id;

  if v_customer.id is null then
    raise exception 'create_order_from_bid: customer record could not be resolved';
  end if;

  if v_bid.converted_order_id is not null then
    return jsonb_build_object('ok', true, 'order_id', v_bid.converted_order_id, 'existing', true);
  end if;

  v_status := case
    when lower(coalesce(v_bid.status, '')) = 'approved' then 'confirmed'
    else 'quoted'
  end;
  v_deposit_required := greatest(coalesce(v_bid.deposit_amount_cents, 0), 0);

  insert into public.orders (
    tenant_id, operator_id, customer_id, lead_id, bid_id, status, fulfillment,
    scheduled_time, schedule_window, service_address, items, subtotal_cents, total_cents, estimated_total_cents,
    item_count, unpriced_count, cart_summary, notes, source_type, source_ref,
    customer_name, email, phone, preferred_contact, payment_due_date,
    deposit_required_cents, deposit_policy, deposit_due_date, created_at, updated_at
  )
  select
    v_bid.tenant_id,
    v_bid.operator_id,
    v_bid.customer_id,
    v_bid.lead_id,
    v_bid.id,
    v_status,
    'service',
    v_bid.schedule_window,
    v_bid.schedule_window,
    v_bid.service_address,
    coalesce(v_bid.line_items, '[]'::jsonb),
    coalesce(v_bid.total_cents, 0),
    coalesce(v_bid.total_cents, 0),
    coalesce(v_bid.total_cents, 0),
    greatest(coalesce(jsonb_array_length(v_bid.line_items), 0), 0),
    0,
    coalesce(v_bid.project_summary, v_bid.title, 'Service bid'),
    concat_ws(E'\n\n',
      nullif(v_bid.scope_of_work, ''),
      nullif(v_bid.proposed_solution, ''),
      nullif(v_bid.internal_notes, '')
    ),
    'service_bid',
    v_bid.id::text,
    v_customer.name,
    v_customer.email,
    v_customer.phone,
    v_customer.preferred_contact,
    v_bid.valid_until,
    v_deposit_required,
    case when v_deposit_required > 0 then 'required_before_job' else 'optional' end,
    case when v_deposit_required > 0 then coalesce(v_bid.valid_until, current_date) else null end,
    now(),
    now()
  returning id into v_order_id;

  if v_order_id is null then
    raise exception 'create_order_from_bid: order insert did not return an id';
  end if;

  update public.bids
     set converted_order_id = v_order_id,
         converted_at = now(),
         status = case when status = 'approved' then 'converted' else status end,
         updated_at = now()
   where id = v_bid.id;

  update public.leads
     set converted_order_id = v_order_id,
         status = 'converted',
         last_activity_at = now(),
         updated_at = now()
   where id = v_bid.lead_id;

  return jsonb_build_object('ok', true, 'order_id', v_order_id, 'existing', false);
end;
$$;

revoke all on function public.create_order_from_bid(uuid) from public;
grant execute on function public.create_order_from_bid(uuid) to authenticated, service_role;

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
  v_deposit_required integer := 0;
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
  v_deposit_required := greatest(coalesce(v_plan.deposit_required_cents, 0), 0);

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
    deposit_policy,
    deposit_due_date,
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
    v_deposit_required,
    case when v_deposit_required > 0 then 'required_before_job' else 'optional' end,
    case when v_deposit_required > 0 then v_scheduled_date else null end,
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
