-- ============================================================================
-- ProofLink employee compensation foundation
-- Stability-first payroll-ready compensation model.
-- Contract floors are minimums; employee and job-level overrides can exceed them.
-- ============================================================================

create table if not exists public.labor_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_name text not null,
  union_name text,
  union_local_number text,
  effective_start_date date not null,
  effective_end_date date,
  status text not null default 'active',
  notes text,
  source_document_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint labor_contracts_status_check
    check (status in ('draft', 'active', 'expired', 'archived'))
);

create index if not exists idx_labor_contracts_tenant_dates
  on public.labor_contracts (tenant_id, effective_start_date desc);

create table if not exists public.labor_contract_classifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.labor_contracts(id) on delete cascade,
  classification_code text,
  classification_name text not null,
  worker_label text,
  driver_label text,
  is_driver_class boolean not null default false,
  apprentice_level text,
  sort_order integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_labor_contract_classifications_tenant_contract
  on public.labor_contract_classifications (tenant_id, contract_id, sort_order);

create table if not exists public.labor_contract_rate_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.labor_contracts(id) on delete cascade,
  classification_id uuid not null references public.labor_contract_classifications(id) on delete cascade,
  effective_start_date date not null,
  effective_end_date date,
  base_hourly_rate_cents integer not null default 0,
  foreman_hourly_premium_cents integer not null default 0,
  general_foreman_hourly_premium_cents integer not null default 0,
  shift_differential_cents integer not null default 0,
  travel_hourly_rate_cents integer not null default 0,
  standby_hourly_rate_cents integer not null default 0,
  per_diem_cents integer not null default 0,
  hazard_hourly_premium_cents integer not null default 0,
  overtime_multiplier numeric(6, 3) not null default 1.500,
  doubletime_multiplier numeric(6, 3) not null default 2.000,
  holiday_multiplier numeric(6, 3) not null default 2.000,
  fringe_package jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_labor_contract_rate_periods_lookup
  on public.labor_contract_rate_periods (tenant_id, classification_id, effective_start_date desc);

create table if not exists public.compensation_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_name text not null,
  compensation_type text not null default 'hourly',
  employment_type text default 'employee',
  worker_label text,
  driver_label text,
  base_hourly_rate_cents integer not null default 0,
  annual_salary_cents bigint not null default 0,
  daily_rate_cents integer not null default 0,
  job_rate_cents integer not null default 0,
  commission_percent numeric(6, 3) not null default 0,
  overtime_multiplier numeric(6, 3) not null default 1.500,
  doubletime_multiplier numeric(6, 3) not null default 2.000,
  holiday_multiplier numeric(6, 3) not null default 2.000,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compensation_profiles_type_check
    check (compensation_type in ('hourly', 'salary', 'day_rate', 'job_rate', 'commission', 'blended')),
  constraint compensation_profiles_employment_type_check
    check (employment_type in ('employee', 'contractor', 'union_employee', 'temporary', 'other'))
);

create index if not exists idx_compensation_profiles_tenant_type
  on public.compensation_profiles (tenant_id, compensation_type);

create table if not exists public.compensation_profile_components (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null references public.compensation_profiles(id) on delete cascade,
  component_type text not null,
  component_name text not null,
  amount_cents integer not null default 0,
  percent_value numeric(6, 3) not null default 0,
  applies_to text not null default 'all_hours',
  is_taxable boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compensation_profile_components_type_check
    check (component_type in ('premium', 'allowance', 'per_diem', 'hazard', 'travel', 'standby', 'shift_diff', 'commission', 'other')),
  constraint compensation_profile_components_applies_to_check
    check (applies_to in ('all_hours', 'regular_hours', 'overtime_hours', 'doubletime_hours', 'job', 'day', 'week', 'pay_period'))
);

create index if not exists idx_comp_profile_components_profile
  on public.compensation_profile_components (tenant_id, profile_id);

create table if not exists public.member_compensation_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null,
  compensation_profile_id uuid references public.compensation_profiles(id) on delete set null,
  compensation_type text not null default 'hourly',
  employment_type text default 'employee',
  worker_label text,
  driver_label text,
  base_hourly_rate_cents integer not null default 0,
  annual_salary_cents bigint not null default 0,
  daily_rate_cents integer not null default 0,
  job_rate_cents integer not null default 0,
  commission_percent numeric(6, 3) not null default 0,
  union_classification_id uuid references public.labor_contract_classifications(id) on delete set null,
  is_union_member boolean not null default false,
  pay_source_label text,
  effective_start_date date not null,
  effective_end_date date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_comp_assignments_type_check
    check (compensation_type in ('hourly', 'salary', 'day_rate', 'job_rate', 'commission', 'blended'))
);

create index if not exists idx_member_comp_assignments_lookup
  on public.member_compensation_assignments (tenant_id, member_id, effective_start_date desc);

create table if not exists public.member_compensation_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null,
  override_scope text not null default 'employee',
  override_reason text,
  compensation_type text,
  worker_label text,
  driver_label text,
  hourly_rate_cents integer,
  daily_rate_cents integer,
  job_rate_cents integer,
  commission_percent numeric(6, 3),
  shift_differential_cents integer,
  hazard_hourly_premium_cents integer,
  travel_hourly_rate_cents integer,
  per_diem_cents integer,
  standby_hourly_rate_cents integer,
  is_union_member boolean,
  effective_start_date date not null,
  effective_end_date date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_comp_overrides_scope_check
    check (override_scope in ('employee', 'job', 'temporary', 'manual_correction'))
);

create index if not exists idx_member_comp_overrides_lookup
  on public.member_compensation_overrides (tenant_id, member_id, effective_start_date desc);

create table if not exists public.job_labor_requirements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  worker_label text,
  driver_label text,
  required_headcount integer not null default 1,
  required_classification_id uuid references public.labor_contract_classifications(id) on delete set null,
  minimum_hourly_floor_cents integer not null default 0,
  premium_package jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_job_labor_requirements_tenant_job
  on public.job_labor_requirements (tenant_id, job_id);

create table if not exists public.compensation_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid,
  job_id uuid references public.jobs(id) on delete set null,
  time_entry_id uuid,
  calculation_date date not null,
  resolved_compensation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_compensation_audit_log_lookup
  on public.compensation_audit_log (tenant_id, member_id, calculation_date desc);

alter table public.operator_members
  add column if not exists worker_label text,
  add column if not exists driver_label text,
  add column if not exists compensation_type text not null default 'hourly',
  add column if not exists is_union_member boolean not null default false,
  add column if not exists union_local_number text,
  add column if not exists union_classification_label text;

create or replace function public.compensation_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists labor_contracts_touch_updated_at on public.labor_contracts;
create trigger labor_contracts_touch_updated_at before update on public.labor_contracts
for each row execute procedure public.compensation_touch_updated_at();

drop trigger if exists labor_contract_classifications_touch_updated_at on public.labor_contract_classifications;
create trigger labor_contract_classifications_touch_updated_at before update on public.labor_contract_classifications
for each row execute procedure public.compensation_touch_updated_at();

drop trigger if exists labor_contract_rate_periods_touch_updated_at on public.labor_contract_rate_periods;
create trigger labor_contract_rate_periods_touch_updated_at before update on public.labor_contract_rate_periods
for each row execute procedure public.compensation_touch_updated_at();

drop trigger if exists compensation_profiles_touch_updated_at on public.compensation_profiles;
create trigger compensation_profiles_touch_updated_at before update on public.compensation_profiles
for each row execute procedure public.compensation_touch_updated_at();

drop trigger if exists compensation_profile_components_touch_updated_at on public.compensation_profile_components;
create trigger compensation_profile_components_touch_updated_at before update on public.compensation_profile_components
for each row execute procedure public.compensation_touch_updated_at();

drop trigger if exists member_compensation_assignments_touch_updated_at on public.member_compensation_assignments;
create trigger member_compensation_assignments_touch_updated_at before update on public.member_compensation_assignments
for each row execute procedure public.compensation_touch_updated_at();

drop trigger if exists member_compensation_overrides_touch_updated_at on public.member_compensation_overrides;
create trigger member_compensation_overrides_touch_updated_at before update on public.member_compensation_overrides
for each row execute procedure public.compensation_touch_updated_at();

drop trigger if exists job_labor_requirements_touch_updated_at on public.job_labor_requirements;
create trigger job_labor_requirements_touch_updated_at before update on public.job_labor_requirements
for each row execute procedure public.compensation_touch_updated_at();

alter table public.labor_contracts enable row level security;
alter table public.labor_contract_classifications enable row level security;
alter table public.labor_contract_rate_periods enable row level security;
alter table public.compensation_profiles enable row level security;
alter table public.compensation_profile_components enable row level security;
alter table public.member_compensation_assignments enable row level security;
alter table public.member_compensation_overrides enable row level security;
alter table public.job_labor_requirements enable row level security;
alter table public.compensation_audit_log enable row level security;

do $$ begin
  create policy "Service role full access on labor_contracts"
    on public.labor_contracts for all to service_role using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on labor_contract_classifications"
    on public.labor_contract_classifications for all to service_role using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on labor_contract_rate_periods"
    on public.labor_contract_rate_periods for all to service_role using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on compensation_profiles"
    on public.compensation_profiles for all to service_role using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on compensation_profile_components"
    on public.compensation_profile_components for all to service_role using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on member_compensation_assignments"
    on public.member_compensation_assignments for all to service_role using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on member_compensation_overrides"
    on public.member_compensation_overrides for all to service_role using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on job_labor_requirements"
    on public.job_labor_requirements for all to service_role using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on compensation_audit_log"
    on public.compensation_audit_log for all to service_role using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy labor_contracts_tenant_all on public.labor_contracts
    for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id::text))
    with check (public.current_user_can_access_tenant(tenant_id::text));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy labor_contract_classifications_tenant_all on public.labor_contract_classifications
    for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id::text))
    with check (public.current_user_can_access_tenant(tenant_id::text));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy labor_contract_rate_periods_tenant_all on public.labor_contract_rate_periods
    for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id::text))
    with check (public.current_user_can_access_tenant(tenant_id::text));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy compensation_profiles_tenant_all on public.compensation_profiles
    for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id::text))
    with check (public.current_user_can_access_tenant(tenant_id::text));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy compensation_profile_components_tenant_all on public.compensation_profile_components
    for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id::text))
    with check (public.current_user_can_access_tenant(tenant_id::text));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy member_compensation_assignments_tenant_all on public.member_compensation_assignments
    for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id::text))
    with check (public.current_user_can_access_tenant(tenant_id::text));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy member_compensation_overrides_tenant_all on public.member_compensation_overrides
    for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id::text))
    with check (public.current_user_can_access_tenant(tenant_id::text));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy job_labor_requirements_tenant_all on public.job_labor_requirements
    for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id::text))
    with check (public.current_user_can_access_tenant(tenant_id::text));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy compensation_audit_log_tenant_all on public.compensation_audit_log
    for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id::text))
    with check (public.current_user_can_access_tenant(tenant_id::text));
exception when duplicate_object then null;
end $$;

grant select, insert, update, delete on table public.labor_contracts to authenticated, service_role;
grant select, insert, update, delete on table public.labor_contract_classifications to authenticated, service_role;
grant select, insert, update, delete on table public.labor_contract_rate_periods to authenticated, service_role;
grant select, insert, update, delete on table public.compensation_profiles to authenticated, service_role;
grant select, insert, update, delete on table public.compensation_profile_components to authenticated, service_role;
grant select, insert, update, delete on table public.member_compensation_assignments to authenticated, service_role;
grant select, insert, update, delete on table public.member_compensation_overrides to authenticated, service_role;
grant select, insert, update, delete on table public.job_labor_requirements to authenticated, service_role;
grant select, insert, update, delete on table public.compensation_audit_log to authenticated, service_role;
