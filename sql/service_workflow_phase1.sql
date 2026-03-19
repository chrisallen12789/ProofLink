-- ============================================================================
-- ProofLink Phase 1 Service Workflow Foundation
-- Run after sql/catchup_run_this.sql
-- Adds first-class leads, bids, jobs, and normalized order payment state.
-- ============================================================================

alter table public.operator_members
  add column if not exists user_id uuid;

alter table public.customers
  add column if not exists company_name text,
  add column if not exists lead_source text,
  add column if not exists service_address text,
  add column if not exists billing_address text,
  add column if not exists tags jsonb not null default '[]'::jsonb;

alter table public.orders
  add column if not exists lead_id uuid,
  add column if not exists bid_id uuid,
  add column if not exists primary_job_id uuid,
  add column if not exists payment_state text not null default 'unpaid',
  add column if not exists amount_paid_cents bigint not null default 0,
  add column if not exists amount_due_cents bigint not null default 0,
  add column if not exists payment_due_date date,
  add column if not exists deposit_required_cents integer not null default 0,
  add column if not exists deposit_paid_cents bigint not null default 0,
  add column if not exists booked_at timestamptz,
  add column if not exists completed_at timestamptz;

do $$ begin
  alter table public.orders
    add constraint orders_payment_state_check
    check (payment_state in ('unpaid','partial','paid','overdue','refunded','void'));
exception when duplicate_object then null;
end $$;

alter table public.payments
  add column if not exists job_id uuid,
  add column if not exists reference_number text,
  add column if not exists note text,
  add column if not exists received_at timestamptz,
  add column if not exists is_manual boolean not null default false;

alter table public.expenses
  add column if not exists customer_id uuid,
  add column if not exists order_id uuid,
  add column if not exists job_id uuid,
  add column if not exists expense_type text not null default 'overhead',
  add column if not exists billable boolean not null default false,
  add column if not exists reimbursable boolean not null default false,
  add column if not exists used_materials jsonb not null default '[]'::jsonb;

do $$ begin
  alter table public.expenses
    add constraint expenses_expense_type_check
    check (expense_type in ('job_cost','material','labor','vendor_bill','overhead','reimbursement','other'));
exception when duplicate_object then null;
end $$;

create table if not exists public.leads (
  id                     uuid        primary key default gen_random_uuid(),
  tenant_id              text        not null,
  operator_id            uuid        not null,
  customer_id            uuid        references public.customers(id) on delete set null,
  status                 text        not null default 'new',
  source_type            text        not null default 'manual',
  source_ref             text,
  title                  text,
  summary                text,
  requested_service_type text,
  priority               text        not null default 'normal',
  service_address        text,
  contact_name           text,
  contact_email          text,
  contact_phone          text,
  preferred_contact      text        default 'phone',
  notes                  text,
  metadata               jsonb       not null default '{}'::jsonb,
  converted_bid_id       uuid,
  converted_order_id     uuid,
  converted_job_id       uuid,
  last_activity_at       timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint leads_status_check
    check (status in ('new','contacted','qualified','quoted','converted','lost','archived')),
  constraint leads_priority_check
    check (priority in ('low','normal','high','urgent'))
);

create index if not exists idx_leads_tenant_operator
  on public.leads (tenant_id, operator_id, created_at desc);
create index if not exists idx_leads_tenant_status
  on public.leads (tenant_id, status, created_at desc);
create index if not exists idx_leads_customer
  on public.leads (customer_id, created_at desc);

alter table public.leads enable row level security;

do $$ begin
  create policy "Service role full access on leads"
    on public.leads for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

create table if not exists public.bids (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            text        not null,
  operator_id          uuid        not null,
  lead_id              uuid        references public.leads(id) on delete set null,
  customer_id          uuid        references public.customers(id) on delete set null,
  status               text        not null default 'draft',
  profile              text        not null default 'general_service',
  title                text,
  walkthrough_at       timestamptz,
  valid_until          date,
  service_address      text,
  site_contact         text,
  schedule_window      text,
  project_summary      text,
  scope_of_work        text,
  proposed_solution    text,
  materials_plan       text,
  unused_materials_plan text,
  exclusions           text,
  warranty             text,
  cover_note           text,
  internal_notes       text,
  deposit_percent      numeric(6,2) not null default 0,
  deposit_amount_cents integer     not null default 0,
  terms                text,
  line_items           jsonb       not null default '[]'::jsonb,
  photos               jsonb       not null default '[]'::jsonb,
  subtotal_cents       integer     not null default 0,
  optional_total_cents integer     not null default 0,
  total_cents          integer     not null default 0,
  metadata             jsonb       not null default '{}'::jsonb,
  converted_order_id   uuid        references public.orders(id) on delete set null,
  sent_at              timestamptz,
  approved_at          timestamptz,
  converted_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint bids_status_check
    check (status in ('draft','walkthrough_complete','ready_to_send','sent','approved','declined','expired','converted'))
);

create index if not exists idx_bids_tenant_operator
  on public.bids (tenant_id, operator_id, updated_at desc);
create index if not exists idx_bids_tenant_status
  on public.bids (tenant_id, status, updated_at desc);
create index if not exists idx_bids_customer
  on public.bids (customer_id, updated_at desc);
create index if not exists idx_bids_lead
  on public.bids (lead_id, updated_at desc);

alter table public.bids enable row level security;

do $$ begin
  create policy "Service role full access on bids"
    on public.bids for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

create table if not exists public.jobs (
  id                uuid        primary key default gen_random_uuid(),
  tenant_id         text        not null,
  operator_id       uuid        not null,
  order_id          uuid        not null references public.orders(id) on delete cascade,
  customer_id       uuid        references public.customers(id) on delete set null,
  bid_id            uuid        references public.bids(id) on delete set null,
  assigned_operator_id uuid     references public.operators(id) on delete set null,
  status            text        not null default 'scheduled',
  title             text,
  service_address   text,
  scheduled_date    date,
  scheduled_time    text,
  schedule_window   text,
  summary           text,
  notes             text,
  proof             jsonb       not null default '[]'::jsonb,
  payment_state     text        not null default 'unpaid',
  amount_paid_cents bigint      not null default 0,
  amount_due_cents  bigint      not null default 0,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint jobs_status_check
    check (status in ('scheduled','dispatched','in_progress','blocked','completed','cancelled')),
  constraint jobs_payment_state_check
    check (payment_state in ('unpaid','partial','paid','overdue','refunded','void'))
);

create index if not exists idx_jobs_tenant_operator
  on public.jobs (tenant_id, operator_id, created_at desc);
create index if not exists idx_jobs_order
  on public.jobs (order_id, created_at desc);
create index if not exists idx_jobs_tenant_status
  on public.jobs (tenant_id, status, created_at desc);
create index if not exists idx_jobs_customer
  on public.jobs (customer_id, created_at desc);

alter table public.jobs enable row level security;

do $$ begin
  create policy "Service role full access on jobs"
    on public.jobs for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.orders
    add constraint orders_lead_id_fkey
    foreign key (lead_id) references public.leads(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.orders
    add constraint orders_bid_id_fkey
    foreign key (bid_id) references public.bids(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.orders
    add constraint orders_primary_job_id_fkey
    foreign key (primary_job_id) references public.jobs(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.payments
    add constraint payments_job_id_fkey
    foreign key (job_id) references public.jobs(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.expenses
    add constraint expenses_customer_id_fkey
    foreign key (customer_id) references public.customers(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.expenses
    add constraint expenses_order_id_fkey
    foreign key (order_id) references public.orders(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.expenses
    add constraint expenses_job_id_fkey
    foreign key (job_id) references public.jobs(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.leads
    add constraint leads_converted_bid_id_fkey
    foreign key (converted_bid_id) references public.bids(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.leads
    add constraint leads_converted_order_id_fkey
    foreign key (converted_order_id) references public.orders(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.leads
    add constraint leads_converted_job_id_fkey
    foreign key (converted_job_id) references public.jobs(id) on delete set null;
exception when duplicate_object then null;
end $$;

drop trigger if exists leads_updated_at_trigger on public.leads;
create trigger leads_updated_at_trigger
  before update on public.leads
  for each row execute function public.set_updated_at();

drop trigger if exists bids_updated_at_trigger on public.bids;
create trigger bids_updated_at_trigger
  before update on public.bids
  for each row execute function public.set_updated_at();

drop trigger if exists jobs_updated_at_trigger on public.jobs;
create trigger jobs_updated_at_trigger
  before update on public.jobs
  for each row execute function public.set_updated_at();

create or replace function public.ensure_record_tenant(target_table regclass, target_id uuid, target_tenant_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant text;
begin
  if target_id is null or nullif(btrim(coalesce(target_tenant_id, '')), '') is null then
    return true;
  end if;

  execute format('select tenant_id::text from %s where id = $1', target_table)
    into v_tenant
    using target_id;

  return v_tenant is not null and btrim(v_tenant) = btrim(target_tenant_id);
end;
$$;

revoke all on function public.ensure_record_tenant(regclass, uuid, text) from public;
grant execute on function public.ensure_record_tenant(regclass, uuid, text) to authenticated, service_role;

create or replace function public.enforce_lead_relationships()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.ensure_record_tenant('public.customers'::regclass, new.customer_id, new.tenant_id) then
    raise exception 'Lead customer must belong to the same tenant.';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_bid_relationships()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.ensure_record_tenant('public.leads'::regclass, new.lead_id, new.tenant_id) then
    raise exception 'Bid lead must belong to the same tenant.';
  end if;
  if not public.ensure_record_tenant('public.customers'::regclass, new.customer_id, new.tenant_id) then
    raise exception 'Bid customer must belong to the same tenant.';
  end if;
  if new.lead_id is not null and new.customer_id is not null then
    if not exists (
      select 1 from public.leads l
      where l.id = new.lead_id
        and l.tenant_id = new.tenant_id
        and (l.customer_id is null or l.customer_id = new.customer_id)
    ) then
      raise exception 'Bid lead and customer do not align.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_order_relationships_phase1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.ensure_record_tenant('public.customers'::regclass, new.customer_id, new.tenant_id) then
    raise exception 'Order customer must belong to the same tenant.';
  end if;
  if not public.ensure_record_tenant('public.leads'::regclass, new.lead_id, new.tenant_id) then
    raise exception 'Order lead must belong to the same tenant.';
  end if;
  if not public.ensure_record_tenant('public.bids'::regclass, new.bid_id, new.tenant_id) then
    raise exception 'Order bid must belong to the same tenant.';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_job_relationships()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_order record;
begin
  if not public.ensure_record_tenant('public.orders'::regclass, new.order_id, new.tenant_id) then
    raise exception 'Job order must belong to the same tenant.';
  end if;
  if not public.ensure_record_tenant('public.customers'::regclass, new.customer_id, new.tenant_id) then
    raise exception 'Job customer must belong to the same tenant.';
  end if;
  if not public.ensure_record_tenant('public.bids'::regclass, new.bid_id, new.tenant_id) then
    raise exception 'Job bid must belong to the same tenant.';
  end if;

  select tenant_id, customer_id, bid_id into v_order
  from public.orders
  where id = new.order_id;

  if v_order.tenant_id is null then
    raise exception 'Job order could not be resolved.';
  end if;
  if new.customer_id is null then
    new.customer_id := v_order.customer_id;
  elsif v_order.customer_id is not null and new.customer_id <> v_order.customer_id then
    raise exception 'Job customer must match the linked order customer.';
  end if;
  if new.bid_id is null then
    new.bid_id := v_order.bid_id;
  elsif v_order.bid_id is not null and new.bid_id <> v_order.bid_id then
    raise exception 'Job bid must match the linked order bid.';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_payment_relationships_phase1()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_job record;
  v_order record;
begin
  if not public.ensure_record_tenant('public.orders'::regclass, new.order_id, new.tenant_id) then
    raise exception 'Payment order must belong to the same tenant.';
  end if;
  if not public.ensure_record_tenant('public.customers'::regclass, new.customer_id, new.tenant_id) then
    raise exception 'Payment customer must belong to the same tenant.';
  end if;
  if not public.ensure_record_tenant('public.jobs'::regclass, new.job_id, new.tenant_id) then
    raise exception 'Payment job must belong to the same tenant.';
  end if;

  if new.job_id is not null then
    select order_id, customer_id into v_job
    from public.jobs
    where id = new.job_id;
    if new.order_id is null then
      new.order_id := v_job.order_id;
    elsif v_job.order_id is not null and new.order_id <> v_job.order_id then
      raise exception 'Payment order must match the linked job order.';
    end if;
    if new.customer_id is null then
      new.customer_id := v_job.customer_id;
    elsif v_job.customer_id is not null and new.customer_id <> v_job.customer_id then
      raise exception 'Payment customer must match the linked job customer.';
    end if;
  end if;

  if new.order_id is not null then
    select customer_id into v_order
    from public.orders
    where id = new.order_id;
    if new.customer_id is null then
      new.customer_id := v_order.customer_id;
    elsif v_order.customer_id is not null and new.customer_id <> v_order.customer_id then
      raise exception 'Payment customer must match the linked order customer.';
    end if;
  end if;

  if new.reference_number is null then
    new.reference_number := nullif(trim(coalesce(new.metadata->>'reference', '')), '');
  end if;
  if new.note is null then
    new.note := nullif(trim(coalesce(new.metadata->>'note', '')), '');
  end if;
  if new.received_at is null then
    new.received_at := coalesce(new.paid_at, now());
  end if;
  if new.is_manual = false then
    new.is_manual := lower(coalesce(new.source, '')) = 'manual'
      or lower(coalesce(new.payment_mode, '')) in ('cash','check','ach','zelle','venmo','external_card','manual_other');
  end if;
  return new;
end;
$$;

create or replace function public.enforce_expense_relationships_phase1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.ensure_record_tenant('public.customers'::regclass, new.customer_id, new.tenant_id) then
    raise exception 'Expense customer must belong to the same tenant.';
  end if;
  if not public.ensure_record_tenant('public.orders'::regclass, new.order_id, new.tenant_id) then
    raise exception 'Expense order must belong to the same tenant.';
  end if;
  if not public.ensure_record_tenant('public.jobs'::regclass, new.job_id, new.tenant_id) then
    raise exception 'Expense job must belong to the same tenant.';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_operator_tenant_pair_guard on public.leads;
create trigger leads_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.leads
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists bids_operator_tenant_pair_guard on public.bids;
create trigger bids_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.bids
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists jobs_operator_tenant_pair_guard on public.jobs;
create trigger jobs_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.jobs
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists leads_relationship_guard on public.leads;
create trigger leads_relationship_guard
  before insert or update on public.leads
  for each row execute function public.enforce_lead_relationships();

drop trigger if exists bids_relationship_guard on public.bids;
create trigger bids_relationship_guard
  before insert or update on public.bids
  for each row execute function public.enforce_bid_relationships();

drop trigger if exists orders_relationship_guard_phase1 on public.orders;
create trigger orders_relationship_guard_phase1
  before insert or update of customer_id, lead_id, bid_id, tenant_id
  on public.orders
  for each row execute function public.enforce_order_relationships_phase1();

drop trigger if exists jobs_relationship_guard on public.jobs;
create trigger jobs_relationship_guard
  before insert or update on public.jobs
  for each row execute function public.enforce_job_relationships();

drop trigger if exists payments_relationship_guard_phase1 on public.payments;
create trigger payments_relationship_guard_phase1
  before insert or update of order_id, customer_id, job_id, metadata, paid_at, source, payment_mode
  on public.payments
  for each row execute function public.enforce_payment_relationships_phase1();

drop trigger if exists expenses_relationship_guard_phase1 on public.expenses;
create trigger expenses_relationship_guard_phase1
  before insert or update of customer_id, order_id, job_id, tenant_id
  on public.expenses
  for each row execute function public.enforce_expense_relationships_phase1();

grant select, insert, update, delete on public.leads to authenticated;
grant select, insert, update, delete on public.bids to authenticated;
grant select, insert, update, delete on public.jobs to authenticated;

do $$ begin
  drop policy if exists leads_operator_all on public.leads;
  create policy leads_operator_all on public.leads for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists bids_operator_all on public.bids;
  create policy bids_operator_all on public.bids for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists jobs_operator_all on public.jobs;
  create policy jobs_operator_all on public.jobs for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

create or replace function public.payment_net_amount_cents(p_status text, p_amount_total bigint)
returns bigint
language sql
immutable
as $$
  select case
    when p_amount_total is null then 0
    when lower(coalesce(p_status, '')) in ('pending','failed','cancelled','voided','checkout_created') then 0
    when lower(coalesce(p_status, '')) like '%refund%' then -abs(p_amount_total)
    else p_amount_total
  end;
$$;

create or replace function public.recompute_order_payment_state(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_paid bigint := 0;
  v_total bigint := 0;
  v_due bigint := 0;
  v_state text := 'unpaid';
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id;

  if v_order.id is null then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  select coalesce(sum(public.payment_net_amount_cents(status, coalesce(amount_total, amount_subtotal, 0))), 0)
  into v_paid
  from public.payments
  where order_id = p_order_id;

  v_total := greatest(
    coalesce(v_order.total_cents::bigint, 0),
    coalesce(v_order.estimated_total_cents::bigint, 0),
    coalesce(v_order.subtotal_cents::bigint, 0)
  );
  v_due := greatest(v_total - greatest(v_paid, 0), 0);

  if lower(coalesce(v_order.status, '')) in ('cancelled') then
    v_state := 'void';
  elsif v_paid < 0 then
    v_state := 'refunded';
  elsif v_due <= 0 and greatest(v_paid, 0) > 0 then
    v_state := 'paid';
  elsif greatest(v_paid, 0) > 0 and v_due > 0 then
    v_state := 'partial';
  elsif v_due > 0 and v_order.payment_due_date is not null and v_order.payment_due_date < current_date then
    v_state := 'overdue';
  else
    v_state := 'unpaid';
  end if;

  update public.orders
     set amount_paid_cents = greatest(v_paid, 0),
         amount_due_cents = v_due,
         deposit_paid_cents = least(greatest(v_paid, 0), greatest(coalesce(deposit_required_cents, 0), 0)),
         payment_state = v_state,
         updated_at = now()
   where id = p_order_id;

  update public.jobs
     set amount_paid_cents = greatest(v_paid, 0),
         amount_due_cents = v_due,
         payment_state = v_state,
         updated_at = now()
   where order_id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'payment_state', v_state,
    'amount_paid_cents', greatest(v_paid, 0),
    'amount_due_cents', v_due
  );
end;
$$;

revoke all on function public.recompute_order_payment_state(uuid) from public;
grant execute on function public.recompute_order_payment_state(uuid) to authenticated, service_role;

create or replace function public.payments_sync_order_payment_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT','UPDATE') and new.order_id is not null then
    perform public.recompute_order_payment_state(new.order_id);
  end if;
  if tg_op = 'DELETE' and old.order_id is not null then
    perform public.recompute_order_payment_state(old.order_id);
  elsif tg_op = 'UPDATE' and old.order_id is not null and old.order_id is distinct from new.order_id then
    perform public.recompute_order_payment_state(old.order_id);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists payments_sync_order_payment_state on public.payments;
create trigger payments_sync_order_payment_state
  after insert or update or delete on public.payments
  for each row execute function public.payments_sync_order_payment_state();

create or replace function public.orders_sync_payment_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_order_payment_state(new.id);
  return new;
end;
$$;

drop trigger if exists orders_sync_payment_state on public.orders;
create trigger orders_sync_payment_state
  after insert or update of total_cents, estimated_total_cents, subtotal_cents, payment_due_date, status, deposit_required_cents
  on public.orders
  for each row execute function public.orders_sync_payment_state();

create or replace function public.jobs_sync_order_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
     set primary_job_id = coalesce(primary_job_id, new.id),
         booked_at = coalesce(booked_at, now()),
         updated_at = now(),
         status = case
           when lower(coalesce(status, '')) in ('new','quoted') then 'confirmed'
           else status
         end
   where id = new.order_id;

  perform public.recompute_order_payment_state(new.order_id);
  return new;
end;
$$;

drop trigger if exists jobs_sync_order_link on public.jobs;
create trigger jobs_sync_order_link
  after insert on public.jobs
  for each row execute function public.jobs_sync_order_link();

create or replace function public.current_user_can_access_operator_record(target_operator_id uuid, target_tenant_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.operator_member_tenant_access(target_operator_id, target_tenant_id);
$$;

revoke all on function public.current_user_can_access_operator_record(uuid, text) from public;
grant execute on function public.current_user_can_access_operator_record(uuid, text) to authenticated, service_role;

create or replace function public.submit_service_lead(payload jsonb)
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
  v_lead_id uuid;
  v_name text := nullif(trim(coalesce(payload->>'customer_name', payload->>'name', '')), '');
  v_email text := lower(nullif(trim(coalesce(payload->>'email', '')), ''));
  v_phone text := nullif(trim(coalesce(payload->>'phone', '')), '');
  v_preferred text := coalesce(nullif(trim(coalesce(payload->>'preferred_contact', '')), ''), 'phone');
  v_summary text := nullif(trim(coalesce(payload->>'summary', payload->>'project_summary', payload->>'notes', '')), '');
  v_service text := nullif(trim(coalesce(payload->>'requested_service_type', payload->>'service_type', '')), '');
  v_service_address text := nullif(trim(coalesce(payload->>'service_address', '')), '');
  v_source_type text := coalesce(nullif(trim(coalesce(payload->>'source_type', '')), ''), 'website_service_intake');
begin
  if v_tenant_id is null and v_tenant_slug is null then
    raise exception 'submit_service_lead: tenant_id or tenant_slug is required';
  end if;
  if v_tenant_id is null then
    select id::text into v_tenant_id
    from public.tenants
    where slug = v_tenant_slug
    limit 1;
  end if;
  if v_tenant_id is null then
    raise exception 'submit_service_lead: tenant could not be resolved';
  end if;
  if v_name is null then
    raise exception 'submit_service_lead: customer_name is required';
  end if;

  select o.id into v_operator_id
  from public.operators o
  where o.tenant_id::text = v_tenant_id
  order by o.created_at nulls first, o.id
  limit 1;

  if v_operator_id is null then
    raise exception 'submit_service_lead: no operator found for tenant %', v_tenant_id;
  end if;

  if v_email is not null or v_phone is not null then
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
  end if;

  if v_customer_id is null then
    insert into public.customers (
      tenant_id, operator_id, name, email, phone, preferred_contact, notes,
      lead_source, service_address, created_at, updated_at, last_contact_at
    ) values (
      v_tenant_id, v_operator_id, v_name, v_email, v_phone, v_preferred, v_summary,
      v_source_type, v_service_address, now(), now(), now()
    )
    returning id into v_customer_id;
  else
    update public.customers
       set name = coalesce(v_name, name),
           email = coalesce(v_email, email),
           phone = coalesce(v_phone, phone),
           preferred_contact = coalesce(v_preferred, preferred_contact),
           lead_source = coalesce(lead_source, v_source_type),
           service_address = coalesce(v_service_address, service_address),
           last_contact_at = now(),
           updated_at = now()
     where id = v_customer_id;
  end if;

  insert into public.leads (
    tenant_id, operator_id, customer_id, status, source_type, source_ref,
    title, summary, requested_service_type, service_address,
    contact_name, contact_email, contact_phone, preferred_contact, notes,
    metadata, last_activity_at, created_at, updated_at
  ) values (
    v_tenant_id, v_operator_id, v_customer_id, 'new', v_source_type, v_tenant_slug,
    coalesce(v_service, 'Service request'), v_summary, v_service, v_service_address,
    v_name, v_email, v_phone, v_preferred, v_summary,
    jsonb_build_object('submitted_via', v_source_type),
    now(), now(), now()
  )
  returning id into v_lead_id;

  return jsonb_build_object(
    'ok', true,
    'lead_id', v_lead_id,
    'customer_id', v_customer_id,
    'operator_id', v_operator_id,
    'tenant_id', v_tenant_id
  );
end;
$$;

revoke all on function public.submit_service_lead(jsonb) from public;
grant execute on function public.submit_service_lead(jsonb) to anon, authenticated, service_role;

create or replace function public.create_bid_from_lead(p_lead_id uuid, p_profile text default 'general_service')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead record;
  v_bid_id uuid;
begin
  select *
  into v_lead
  from public.leads
  where id = p_lead_id;

  if v_lead.id is null then
    raise exception 'create_bid_from_lead: lead not found';
  end if;

  if not public.current_user_can_access_operator_record(v_lead.operator_id, v_lead.tenant_id) then
    raise exception 'create_bid_from_lead: forbidden';
  end if;

  if v_lead.converted_bid_id is not null then
    return jsonb_build_object('ok', true, 'bid_id', v_lead.converted_bid_id, 'existing', true);
  end if;

  insert into public.bids (
    tenant_id, operator_id, lead_id, customer_id, status, profile, title,
    service_address, project_summary, internal_notes, walkthrough_at,
    metadata, created_at, updated_at
  ) values (
    v_lead.tenant_id,
    v_lead.operator_id,
    v_lead.id,
    v_lead.customer_id,
    'draft',
    coalesce(nullif(trim(p_profile), ''), 'general_service'),
    coalesce(v_lead.title, v_lead.requested_service_type, 'Service quote'),
    v_lead.service_address,
    coalesce(v_lead.summary, v_lead.notes),
    v_lead.notes,
    now(),
    jsonb_build_object('lead_id', v_lead.id, 'created_from', 'lead'),
    now(),
    now()
  )
  returning id into v_bid_id;

  update public.leads
     set converted_bid_id = v_bid_id,
         status = 'quoted',
         last_activity_at = now(),
         updated_at = now()
   where id = v_lead.id;

  return jsonb_build_object('ok', true, 'bid_id', v_bid_id, 'existing', false);
end;
$$;

revoke all on function public.create_bid_from_lead(uuid, text) from public;
grant execute on function public.create_bid_from_lead(uuid, text) to authenticated, service_role;

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

  insert into public.orders (
    tenant_id, operator_id, customer_id, lead_id, bid_id, status, fulfillment,
    scheduled_time, items, subtotal_cents, total_cents, estimated_total_cents,
    item_count, unpriced_count, cart_summary, notes, source_type, source_ref,
    customer_name, email, phone, preferred_contact, deposit_required_cents,
    created_at, updated_at
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
    coalesce(v_bid.deposit_amount_cents, 0),
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

create or replace function public.create_job_from_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_customer record;
  v_bid record;
  v_job_id uuid;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id;

  if v_order.id is null then
    raise exception 'create_job_from_order: order not found';
  end if;

  if not public.current_user_can_access_operator_record(v_order.operator_id, v_order.tenant_id) then
    raise exception 'create_job_from_order: forbidden';
  end if;

  if v_order.primary_job_id is not null then
    return jsonb_build_object('ok', true, 'job_id', v_order.primary_job_id, 'existing', true);
  end if;

  if v_order.customer_id is null then
    raise exception 'create_job_from_order: customer_id is required';
  end if;

  select *
  into v_customer
  from public.customers
  where id = v_order.customer_id;

  if v_customer.id is null then
    raise exception 'create_job_from_order: customer record could not be resolved';
  end if;

  if v_order.bid_id is not null then
    select *
    into v_bid
    from public.bids
    where id = v_order.bid_id;
  end if;

  insert into public.jobs (
    tenant_id, operator_id, order_id, customer_id, bid_id, status, title,
    service_address, scheduled_date, scheduled_time, schedule_window, summary, notes,
    payment_state, amount_paid_cents, amount_due_cents,
    created_at, updated_at
  )
  select
    v_order.tenant_id,
    v_order.operator_id,
    v_order.id,
    v_order.customer_id,
    v_order.bid_id,
    'scheduled',
    coalesce(v_bid.title, v_order.cart_summary, 'Service job'),
    coalesce(v_bid.service_address, v_customer.service_address, v_customer.billing_address),
    v_order.scheduled_date,
    v_order.scheduled_time,
    v_bid.schedule_window,
    coalesce(v_order.cart_summary, v_bid.project_summary, 'Tracked service work'),
    v_order.notes,
    v_order.payment_state,
    v_order.amount_paid_cents,
    v_order.amount_due_cents,
    now(),
    now()
  returning id into v_job_id;

  if v_job_id is null then
    raise exception 'create_job_from_order: job insert did not return an id';
  end if;

  update public.orders
     set primary_job_id = v_job_id,
         booked_at = coalesce(booked_at, now()),
         status = case when lower(coalesce(status, '')) in ('new','quoted') then 'confirmed' else status end,
         updated_at = now()
   where id = v_order.id;

  update public.leads
     set converted_job_id = v_job_id,
         last_activity_at = now(),
         updated_at = now()
   where id = v_order.lead_id;

  return jsonb_build_object('ok', true, 'job_id', v_job_id, 'existing', false);
end;
$$;

revoke all on function public.create_job_from_order(uuid) from public;
grant execute on function public.create_job_from_order(uuid) to authenticated, service_role;
