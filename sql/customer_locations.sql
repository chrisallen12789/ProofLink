-- Customer account locations / buildings support
-- Lets one customer account own multiple service sites, campuses, or buildings.

alter table public.customers
  add column if not exists company_name text;

create table if not exists public.customer_locations (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     text        not null,
  operator_id   uuid        not null,
  customer_id   uuid        not null references public.customers(id) on delete cascade,
  site_name     text        not null,
  site_code     text,
  contact_name  text,
  contact_phone text,
  contact_email text,
  address_line1 text,
  city          text,
  state         text,
  zip           text,
  access_notes  text,
  notes         text,
  is_primary    boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.leads
  add column if not exists customer_location_id uuid references public.customer_locations(id) on delete set null;

alter table public.bids
  add column if not exists customer_location_id uuid references public.customer_locations(id) on delete set null;

alter table public.orders
  add column if not exists customer_location_id uuid references public.customer_locations(id) on delete set null;

alter table public.jobs
  add column if not exists customer_location_id uuid references public.customer_locations(id) on delete set null;

alter table public.bookings
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists customer_location_id uuid references public.customer_locations(id) on delete set null;

create index if not exists idx_customer_locations_tenant_operator
  on public.customer_locations (tenant_id, operator_id, customer_id, updated_at desc);
create index if not exists idx_customer_locations_customer
  on public.customer_locations (customer_id, updated_at desc);
create unique index if not exists uq_customer_locations_primary_per_customer
  on public.customer_locations (customer_id)
  where is_primary = true;
create index if not exists idx_leads_customer_location
  on public.leads (tenant_id, customer_id, customer_location_id, updated_at desc);
create index if not exists idx_bids_customer_location
  on public.bids (tenant_id, customer_id, customer_location_id, updated_at desc);
create index if not exists idx_orders_customer_location
  on public.orders (tenant_id, customer_id, customer_location_id, updated_at desc);
create index if not exists idx_jobs_customer_location
  on public.jobs (tenant_id, customer_id, customer_location_id, scheduled_date desc);
create index if not exists idx_bookings_customer_location
  on public.bookings (tenant_id, customer_id, customer_location_id, starts_at desc);

alter table public.customer_locations enable row level security;

do $$ begin
  create policy "Service role full access on customer_locations"
    on public.customer_locations for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  drop policy if exists customer_locations_operator_all on public.customer_locations;
  create policy customer_locations_operator_all on public.customer_locations for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

drop trigger if exists customer_locations_updated_at_trigger on public.customer_locations;
create trigger customer_locations_updated_at_trigger
  before update on public.customer_locations
  for each row execute function public.set_updated_at();

drop trigger if exists customer_locations_operator_tenant_pair_guard on public.customer_locations;
create trigger customer_locations_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.customer_locations
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

revoke all on table public.customer_locations from anon;
grant select, insert, update, delete on table public.customer_locations to authenticated, service_role;
