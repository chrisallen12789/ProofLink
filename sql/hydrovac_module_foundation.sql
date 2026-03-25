-- ============================================================================
-- ProofLink Hydrovac / Vactor Module Foundation
-- Run after sql/catchup_run_this.sql and sql/service_workflow_phase1.sql
-- Adds hydrovac-specific compliance, manifest, equipment, and dispatch schema.
-- ============================================================================

create or replace function public.current_user_can_access_tenant(target_tenant_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(auth.role(), '') = 'service_role'
    or exists (
      select 1
      from public.operator_members om
      where om.user_id = auth.uid()
        and om.tenant_id::text = nullif(btrim(coalesce(target_tenant_id, '')), '')
    );
$$;

revoke all on function public.current_user_can_access_tenant(text) from public;
grant execute on function public.current_user_can_access_tenant(text) to authenticated, service_role;

create or replace function public.hydrovac_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  operator_id uuid,
  name text not null,
  equipment_type text not null default 'hydrovac_truck',
  status text not null default 'available',
  hourly_rate_cents integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_active boolean not null default true
);

alter table public.equipment
  add column if not exists operator_id uuid,
  add column if not exists unit_number text,
  add column if not exists equipment_type text not null default 'hydrovac_truck',
  add column if not exists year integer,
  add column if not exists make text,
  add column if not exists model text,
  add column if not exists model_year integer,
  add column if not exists vin text,
  add column if not exists license_plate text,
  add column if not exists state_registered text,
  add column if not exists dot_number text,
  add column if not exists dot_unit_number text,
  add column if not exists gvwr_lbs integer,
  add column if not exists is_cdl_required boolean not null default true,
  add column if not exists debris_tank_capacity_gallons integer,
  add column if not exists debris_tank_capacity_yards numeric(6,2),
  add column if not exists water_tank_capacity_gallons integer,
  add column if not exists water_pump_gpm integer,
  add column if not exists water_pressure_psi integer,
  add column if not exists vacuum_cfm integer,
  add column if not exists vacuum_hose_diameter_inches numeric(4,1),
  add column if not exists max_hose_length_ft integer,
  add column if not exists boom_length_ft numeric(6,2),
  add column if not exists digging_depth_ft numeric(6,2),
  add column if not exists last_dot_inspection_date date,
  add column if not exists next_dot_inspection_due date,
  add column if not exists last_annual_inspection_date date,
  add column if not exists next_annual_inspection_due date,
  add column if not exists last_tank_inspection_date date,
  add column if not exists next_tank_inspection_due date,
  add column if not exists insurance_expiry_date date,
  add column if not exists registration_expiry_date date,
  add column if not exists ifta_account_number text,
  add column if not exists gps_device_id text,
  add column if not exists gps_provider text,
  add column if not exists current_lat numeric(10,7),
  add column if not exists current_lng numeric(10,7),
  add column if not exists current_location_updated_at timestamptz,
  add column if not exists odometer_miles integer,
  add column if not exists engine_hours numeric(10,2),
  add column if not exists last_service_at timestamptz,
  add column if not exists next_service_due_at timestamptz,
  add column if not exists next_service_due_miles integer,
  add column if not exists next_service_due_hours numeric(10,2),
  add column if not exists acquisition_date date,
  add column if not exists acquisition_cost_cents bigint,
  add column if not exists current_value_cents bigint,
  add column if not exists daily_rate_cents integer,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_equipment_tenant_status on public.equipment (tenant_id, status);
create index if not exists idx_equipment_tenant_type_active on public.equipment (tenant_id, equipment_type, is_active);
create index if not exists idx_equipment_gps_device on public.equipment (tenant_id, gps_device_id);

create table if not exists public.equipment_maintenance_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  maintenance_type text not null,
  description text not null,
  performed_by text,
  vendor_id uuid,
  performed_at timestamptz not null,
  odometer_at_service integer,
  hours_at_service numeric(10,2),
  cost_cents integer not null default 0,
  parts_cost_cents integer not null default 0,
  labor_cost_cents integer not null default 0,
  work_order_number text,
  invoice_number text,
  next_due_date date,
  next_due_miles integer,
  next_due_hours numeric(10,2),
  documents jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  constraint equipment_maintenance_type_check
    check (maintenance_type in ('oil_change','tire_rotation','brake_service','hydraulic_service','vacuum_system','water_pump','debris_tank','annual_inspection','dot_inspection','tank_certification','warranty','repair','other'))
);

create index if not exists idx_equipment_maintenance_equipment on public.equipment_maintenance_log (equipment_id, performed_at desc);
create index if not exists idx_equipment_maintenance_tenant on public.equipment_maintenance_log (tenant_id, performed_at desc);

create table if not exists public.disposal_facilities (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  name text not null,
  facility_type text not null default 'transfer_station',
  status text not null default 'active',
  address text,
  city text,
  state_province text,
  zip_postal text,
  lat numeric(10,7),
  lng numeric(10,7),
  hours_of_operation text,
  permit_number text,
  permit_expiry_date date,
  epa_id text,
  accepts_non_hazardous boolean not null default true,
  accepts_hazardous boolean not null default false,
  accepted_waste_types text[] default '{}'::text[],
  price_per_gallon_cents integer,
  price_per_cubic_yard_cents integer,
  price_per_ton_cents integer,
  minimum_charge_cents integer,
  fuel_surcharge_percent numeric(5,2),
  primary_contact_name text,
  primary_contact_phone text,
  primary_contact_email text,
  dispatch_phone text,
  after_hours_phone text,
  account_number text,
  approved_profiles jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint disposal_facility_type_check
    check (facility_type in ('transfer_station','landfill','treatment_plant','recycling','liquid_waste_processor','class_1_hazardous','class_2','class_3')),
  constraint disposal_facility_status_check
    check (status in ('active','inactive','preferred'))
);

create index if not exists idx_disposal_facilities_tenant_status on public.disposal_facilities (tenant_id, status);
create index if not exists idx_disposal_facilities_location on public.disposal_facilities (tenant_id, state_province, city);

create table if not exists public.tenant_hydrovac_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null unique,
  default_billing_method text default 'hourly_plus_disposal',
  default_hourly_rate_cents integer default 0,
  default_mobilization_cents integer default 0,
  default_disposal_markup_percent numeric(5,2) default 15.00,
  portal_to_portal_billing boolean default true,
  yard_address text,
  yard_lat numeric(10,7),
  yard_lng numeric(10,7),
  require_locate_ticket_for_excavation boolean default true,
  require_confined_space_permit boolean default true,
  default_ticket_validity_days integer default 10,
  emergency_callout_rate_cents integer default 0,
  emergency_hourly_multiplier numeric(4,2) default 1.50,
  dot_number text,
  usdot_registered boolean default false,
  manifest_prefix text default 'HV',
  permit_prefix text default 'CS',
  auto_generate_manifest_numbers boolean default true,
  notify_on_ticket_expiry boolean default true,
  notify_on_permit_expiry boolean default true,
  notify_on_compliance_warning boolean default true,
  compliance_alert_email text,
  gps_provider text,
  gps_api_key_encrypted text,
  gps_sync_enabled boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hydrovac_settings_billing_method_check
    check (default_billing_method in ('hourly','hourly_plus_disposal','time_and_material','unit_price','flat_rate','emergency_rate'))
);

create table if not exists public.utility_locate_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  job_id uuid references public.jobs(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  ticket_number text not null,
  ticket_type text not null default 'standard',
  one_call_center text,
  state_province text,
  county text,
  work_site_address text not null,
  work_site_city text,
  excavation_type text,
  depth_of_excavation_ft numeric(8,2),
  work_area_description text,
  status text not null default 'requested',
  requested_at timestamptz,
  valid_from timestamptz,
  valid_until timestamptz,
  extended_until timestamptz,
  extension_ticket_number text,
  all_clear boolean,
  utilities_notified text[] default '{}'::text[],
  conflict_utilities text[] default '{}'::text[],
  locate_notes text,
  verified_on_site boolean not null default false,
  verified_by_member_id uuid references public.operator_members(id) on delete set null,
  verified_at timestamptz,
  damage_occurred boolean not null default false,
  damage_notes text,
  created_by_member_id uuid references public.operator_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint utility_locate_tickets_type_check
    check (ticket_type in ('standard','emergency','continue','update','design')),
  constraint utility_locate_tickets_status_check
    check (status in ('requested','active','extended','expired','cancelled'))
);

create index if not exists idx_locate_tickets_job on public.utility_locate_tickets (job_id);
create index if not exists idx_locate_tickets_tenant_valid_until on public.utility_locate_tickets (tenant_id, valid_until);
create index if not exists idx_locate_tickets_status on public.utility_locate_tickets (tenant_id, status, valid_until);
create unique index if not exists idx_locate_tickets_tenant_number on public.utility_locate_tickets (tenant_id, ticket_number);

create table if not exists public.waste_manifests (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  job_id uuid references public.jobs(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  truck_id uuid references public.equipment(id) on delete set null,
  driver_member_id uuid references public.operator_members(id) on delete set null,
  manifest_number text,
  external_manifest_number text,
  manifest_type text not null default 'non_hazardous',
  material_type text not null,
  material_description text,
  waste_profile_number text,
  un_number text,
  hazard_class text,
  quantity_unit text not null default 'gallons',
  quantity_estimated numeric(12,3),
  quantity_actual numeric(12,3),
  tare_weight_lbs numeric(10,2),
  gross_weight_lbs numeric(10,2),
  net_weight_lbs numeric(10,2)
    generated always as (
      case when gross_weight_lbs is not null and tare_weight_lbs is not null
        then gross_weight_lbs - tare_weight_lbs
        else null
      end
    ) stored,
  pickup_address text not null,
  pickup_lat numeric(10,7),
  pickup_lng numeric(10,7),
  generator_name text,
  generator_epa_id text,
  departed_site_at timestamptz,
  arrived_facility_at timestamptz,
  portal_to_portal_minutes integer,
  disposal_facility_id uuid references public.disposal_facilities(id) on delete set null,
  disposal_facility_name text,
  disposal_facility_permit text,
  disposal_method text,
  disposal_confirmed_at timestamptz,
  disposal_ticket_number text,
  disposal_cost_cents integer not null default 0,
  disposal_charge_cents integer not null default 0,
  is_billable boolean not null default true,
  invoiced boolean not null default false,
  invoice_id uuid,
  driver_signature_url text,
  facility_signature_url text,
  manifest_pdf_url text,
  state_copy_submitted boolean not null default false,
  state_submission_date date,
  status text not null default 'in_transit',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint waste_manifests_type_check
    check (manifest_type in ('non_hazardous','hazardous','rcra','liquid_waste','combination')),
  constraint waste_manifests_unit_check
    check (quantity_unit in ('gallons','cubic_yards','tons','pounds')),
  constraint waste_manifests_status_check
    check (status in ('in_transit','delivered','confirmed','invoiced','void'))
);

create index if not exists idx_manifests_job on public.waste_manifests (job_id);
create index if not exists idx_manifests_tenant_created_at on public.waste_manifests (tenant_id, created_at desc);
create index if not exists idx_manifests_status on public.waste_manifests (tenant_id, status, created_at desc);
create index if not exists idx_manifests_facility on public.waste_manifests (disposal_facility_id, created_at desc);
create index if not exists idx_manifests_invoiced on public.waste_manifests (tenant_id, invoiced, is_billable);
create unique index if not exists idx_manifests_tenant_number on public.waste_manifests (tenant_id, manifest_number);

create table if not exists public.confined_space_permits (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  job_id uuid not null references public.jobs(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  permit_number text,
  space_description text not null,
  space_classification text not null default 'permit_required',
  atmospheric_readings jsonb not null default '[]'::jsonb,
  oxygen_acceptable boolean,
  lel_acceptable boolean,
  h2s_acceptable boolean,
  co_acceptable boolean,
  entry_supervisor_member_id uuid references public.operator_members(id) on delete set null,
  entry_supervisor_name text,
  attendant_member_id uuid references public.operator_members(id) on delete set null,
  attendant_name text,
  authorized_entrants jsonb not null default '[]'::jsonb,
  known_hazards text[] default '{}'::text[],
  hazard_controls text,
  rescue_procedure text,
  rescue_equipment_on_site boolean not null default false,
  rescue_equipment_list text,
  status text not null default 'open',
  permit_issued_at timestamptz,
  permit_valid_until timestamptz,
  permit_closed_at timestamptz,
  closed_by_member_id uuid references public.operator_members(id) on delete set null,
  closure_notes text,
  permit_pdf_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint csp_classification_check
    check (space_classification in ('non_permit','permit_required','alternate_procedure')),
  constraint csp_status_check
    check (status in ('open','closed','cancelled','emergency_cancelled'))
);

create index if not exists idx_csp_job on public.confined_space_permits (job_id);
create index if not exists idx_csp_tenant on public.confined_space_permits (tenant_id, created_at desc);

create table if not exists public.driver_qualifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  member_id uuid not null references public.operator_members(id) on delete cascade,
  cdl_number text,
  cdl_state text,
  cdl_class text,
  cdl_expiry_date date,
  cdl_endorsements text[] default '{}'::text[],
  cdl_restrictions text[] default '{}'::text[],
  medical_certificate_expiry date,
  medical_examiner_name text,
  medical_national_registry_num text,
  last_pre_employment_test_date date,
  last_random_test_date date,
  drug_test_consortium text,
  dot_drug_test_clearinghouse_enrolled boolean not null default false,
  hazmat_certified boolean not null default false,
  hazmat_cert_expiry_date date,
  confined_space_certified boolean not null default false,
  confined_space_cert_expiry_date date,
  h2s_alive_certified boolean not null default false,
  h2s_cert_expiry_date date,
  first_aid_certified boolean not null default false,
  first_aid_cert_expiry_date date,
  defensive_driving_completed boolean not null default false,
  last_mvr_check_date date,
  mvr_status text,
  hos_available_driving_minutes integer,
  hos_cycle_used_minutes integer,
  hos_last_synced_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_driver_quals_member on public.driver_qualifications (member_id);
create index if not exists idx_driver_quals_tenant on public.driver_qualifications (tenant_id);

create table if not exists public.infrastructure_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  customer_id uuid references public.customers(id) on delete set null,
  asset_type text not null,
  asset_name text,
  external_asset_id text,
  status text not null default 'active',
  address text,
  city text,
  lat numeric(10,7),
  lng numeric(10,7),
  location_description text,
  gis_feature_id text,
  grid_reference text,
  diameter_inches numeric(6,2),
  depth_ft numeric(8,2),
  capacity_gallons numeric(12,2),
  material text,
  invert_elevation_ft numeric(10,3),
  rim_elevation_ft numeric(10,3),
  last_service_date date,
  last_service_job_id uuid references public.jobs(id) on delete set null,
  service_count_ytd integer not null default 0,
  service_count_total integer not null default 0,
  avg_debris_per_service_gallons numeric(10,2),
  service_frequency_days integer,
  next_service_due_date date,
  service_contract_id uuid,
  last_condition_rating text,
  last_condition_date date,
  condition_notes text,
  has_defects boolean not null default false,
  defect_codes text[] default '{}'::text[],
  notes text,
  photos jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint infrastructure_assets_status_check
    check (status in ('active','needs_service','out_of_service','decommissioned'))
);

create index if not exists idx_assets_customer on public.infrastructure_assets (customer_id);
create index if not exists idx_assets_tenant on public.infrastructure_assets (tenant_id, asset_type, status);
create index if not exists idx_assets_location on public.infrastructure_assets (tenant_id, lat, lng);
create index if not exists idx_assets_service_due on public.infrastructure_assets (tenant_id, next_service_due_date) where status = 'active';

create table if not exists public.job_time_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  job_id uuid not null references public.jobs(id) on delete cascade,
  member_id uuid references public.operator_members(id) on delete set null,
  truck_id uuid references public.equipment(id) on delete set null,
  segment_type text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_minutes integer
    generated always as (
      case when ended_at is not null
        then extract(epoch from (ended_at - started_at))::integer / 60
        else null
      end
    ) stored,
  is_billable boolean not null default true,
  rate_cents_per_hour integer,
  amount_cents integer,
  odometer_start integer,
  odometer_end integer,
  miles_driven integer
    generated always as (
      case when odometer_end is not null and odometer_start is not null
        then odometer_end - odometer_start
        else null
      end
    ) stored,
  notes text,
  created_at timestamptz not null default now(),
  constraint job_time_segment_type_check
    check (segment_type in ('travel_to_site','on_site_work','dump_run_travel','dump_run_wait','standby','travel_return','overtime_wait','other'))
);

create index if not exists idx_time_segments_job on public.job_time_segments (job_id);
create index if not exists idx_time_segments_member on public.job_time_segments (member_id, started_at desc);

create table if not exists public.compliance_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  alert_type text not null,
  severity text not null default 'warning',
  reference_type text,
  reference_id uuid,
  message text not null,
  due_date date,
  days_remaining integer,
  resolved boolean not null default false,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint compliance_alert_severity_check
    check (severity in ('info','warning','critical','expired'))
);

create index if not exists idx_compliance_alerts_tenant on public.compliance_alerts (tenant_id, resolved, severity);
create index if not exists idx_compliance_alerts_ref on public.compliance_alerts (reference_type, reference_id);

alter table public.jobs
  add column if not exists service_type text,
  add column if not exists equipment_id uuid references public.equipment(id) on delete set null,
  add column if not exists billable_hours numeric(8,2),
  add column if not exists minimum_hours numeric(8,2),
  add column if not exists travel_hours numeric(8,2),
  add column if not exists hourly_truck_rate_cents integer not null default 0,
  add column if not exists hourly_operator_rate_cents integer not null default 0,
  add column if not exists after_hours_multiplier numeric(6,2) not null default 1.00,
  add column if not exists mobilization_fee_cents integer not null default 0,
  add column if not exists disposal_cost_cents integer not null default 0,
  add column if not exists job_type text default 'general_service',
  add column if not exists billing_method text default 'hourly',
  add column if not exists mobilization_charge_cents integer default 0,
  add column if not exists standby_rate_cents_per_hour integer default 0,
  add column if not exists water_usage_gallons numeric(10,2),
  add column if not exists water_charge_cents integer default 0,
  add column if not exists total_loads_hauled integer not null default 0,
  add column if not exists total_gallons_hauled numeric(12,2),
  add column if not exists total_yards_hauled numeric(10,2),
  add column if not exists total_disposal_cost_cents integer not null default 0,
  add column if not exists total_disposal_charge_cents integer not null default 0,
  add column if not exists portal_to_portal_minutes integer,
  add column if not exists on_site_minutes integer,
  add column if not exists travel_minutes integer,
  add column if not exists assigned_truck_id uuid references public.equipment(id) on delete set null,
  add column if not exists secondary_truck_id uuid references public.equipment(id) on delete set null,
  add column if not exists assigned_member_id uuid references public.operator_members(id) on delete set null,
  add column if not exists actual_start_at timestamptz,
  add column if not exists actual_end_at timestamptz,
  add column if not exists check_in_lat numeric(10,7),
  add column if not exists check_in_lng numeric(10,7),
  add column if not exists check_out_lat numeric(10,7),
  add column if not exists check_out_lng numeric(10,7),
  add column if not exists completion_photo_required boolean default true,
  add column if not exists before_photos_count integer default 0,
  add column if not exists after_photos_count integer default 0,
  add column if not exists permit_ids uuid[] not null default '{}'::uuid[],
  add column if not exists locate_ticket_ids uuid[] not null default '{}'::uuid[],
  add column if not exists manifest_ids uuid[] not null default '{}'::uuid[],
  add column if not exists emergency_callout boolean default false,
  add column if not exists emergency_callout_rate_applied boolean default false,
  add column if not exists customer_po_number text,
  add column if not exists work_order_number text,
  add column if not exists asset_id uuid references public.infrastructure_assets(id) on delete set null,
  add column if not exists custom_fields jsonb not null default '{}'::jsonb,
  add column if not exists requires_confined_space_permit boolean not null default false;

create index if not exists idx_jobs_tenant_job_type on public.jobs (tenant_id, job_type, status, scheduled_date desc);
create index if not exists idx_jobs_assigned_truck on public.jobs (tenant_id, assigned_truck_id, scheduled_date desc);
create index if not exists idx_jobs_assigned_member on public.jobs (tenant_id, assigned_member_id, scheduled_date desc);

create or replace function public.recompute_hydrovac_job_rollups(p_job_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_total_loads integer := 0;
  v_total_gallons numeric(12,2) := 0;
  v_total_yards numeric(10,2) := 0;
  v_total_cost integer := 0;
  v_total_charge integer := 0;
  v_manifest_ids uuid[] := '{}'::uuid[];
begin
  if p_job_id is null then
    return;
  end if;

  select
    count(*)::integer,
    coalesce(sum(case when quantity_unit = 'gallons' then coalesce(quantity_actual, quantity_estimated, 0) else 0 end), 0)::numeric(12,2),
    coalesce(sum(case when quantity_unit = 'cubic_yards' then coalesce(quantity_actual, quantity_estimated, 0) else 0 end), 0)::numeric(10,2),
    coalesce(sum(disposal_cost_cents), 0)::integer,
    coalesce(sum(disposal_charge_cents), 0)::integer,
    coalesce(array_agg(id order by created_at desc), '{}'::uuid[])
  into
    v_total_loads,
    v_total_gallons,
    v_total_yards,
    v_total_cost,
    v_total_charge,
    v_manifest_ids
  from public.waste_manifests
  where job_id = p_job_id
    and status <> 'void';

  update public.jobs
     set total_loads_hauled = coalesce(v_total_loads, 0),
         total_gallons_hauled = v_total_gallons,
         total_yards_hauled = v_total_yards,
         total_disposal_cost_cents = coalesce(v_total_cost, 0),
         total_disposal_charge_cents = coalesce(v_total_charge, 0),
         manifest_ids = coalesce(v_manifest_ids, '{}'::uuid[]),
         updated_at = now()
   where id = p_job_id;
end;
$$;

create or replace function public.hydrovac_manifests_sync_job_rollups()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.recompute_hydrovac_job_rollups(coalesce(new.job_id, old.job_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists waste_manifests_touch_updated_at on public.waste_manifests;
create trigger waste_manifests_touch_updated_at
  before update on public.waste_manifests
  for each row execute function public.hydrovac_touch_updated_at();

drop trigger if exists utility_locate_tickets_touch_updated_at on public.utility_locate_tickets;
create trigger utility_locate_tickets_touch_updated_at
  before update on public.utility_locate_tickets
  for each row execute function public.hydrovac_touch_updated_at();

drop trigger if exists disposal_facilities_touch_updated_at on public.disposal_facilities;
create trigger disposal_facilities_touch_updated_at
  before update on public.disposal_facilities
  for each row execute function public.hydrovac_touch_updated_at();

drop trigger if exists tenant_hydrovac_settings_touch_updated_at on public.tenant_hydrovac_settings;
create trigger tenant_hydrovac_settings_touch_updated_at
  before update on public.tenant_hydrovac_settings
  for each row execute function public.hydrovac_touch_updated_at();

drop trigger if exists driver_qualifications_touch_updated_at on public.driver_qualifications;
create trigger driver_qualifications_touch_updated_at
  before update on public.driver_qualifications
  for each row execute function public.hydrovac_touch_updated_at();

drop trigger if exists confined_space_permits_touch_updated_at on public.confined_space_permits;
create trigger confined_space_permits_touch_updated_at
  before update on public.confined_space_permits
  for each row execute function public.hydrovac_touch_updated_at();

drop trigger if exists infrastructure_assets_touch_updated_at on public.infrastructure_assets;
create trigger infrastructure_assets_touch_updated_at
  before update on public.infrastructure_assets
  for each row execute function public.hydrovac_touch_updated_at();

drop trigger if exists equipment_touch_updated_at on public.equipment;
create trigger equipment_touch_updated_at
  before update on public.equipment
  for each row execute function public.hydrovac_touch_updated_at();

drop trigger if exists waste_manifests_rollup_sync on public.waste_manifests;
create trigger waste_manifests_rollup_sync
  after insert or update or delete on public.waste_manifests
  for each row execute function public.hydrovac_manifests_sync_job_rollups();

alter table public.disposal_facilities enable row level security;
alter table public.tenant_hydrovac_settings enable row level security;
alter table public.utility_locate_tickets enable row level security;
alter table public.waste_manifests enable row level security;
alter table public.confined_space_permits enable row level security;
alter table public.driver_qualifications enable row level security;
alter table public.infrastructure_assets enable row level security;
alter table public.job_time_segments enable row level security;
alter table public.equipment_maintenance_log enable row level security;
alter table public.compliance_alerts enable row level security;
alter table public.equipment enable row level security;

do $$ begin
  create policy "Service role full access on disposal_facilities"
    on public.disposal_facilities for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on equipment"
    on public.equipment for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on tenant_hydrovac_settings"
    on public.tenant_hydrovac_settings for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on utility_locate_tickets"
    on public.utility_locate_tickets for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on waste_manifests"
    on public.waste_manifests for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on confined_space_permits"
    on public.confined_space_permits for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on driver_qualifications"
    on public.driver_qualifications for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on infrastructure_assets"
    on public.infrastructure_assets for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on job_time_segments"
    on public.job_time_segments for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on equipment_maintenance_log"
    on public.equipment_maintenance_log for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on compliance_alerts"
    on public.compliance_alerts for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  drop policy if exists disposal_facilities_tenant_all on public.disposal_facilities;
  create policy disposal_facilities_tenant_all on public.disposal_facilities for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id))
    with check (public.current_user_can_access_tenant(tenant_id));
end $$;

do $$ begin
  drop policy if exists equipment_tenant_all on public.equipment;
  create policy equipment_tenant_all on public.equipment for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id))
    with check (public.current_user_can_access_tenant(tenant_id));
end $$;

do $$ begin
  drop policy if exists tenant_hydrovac_settings_tenant_all on public.tenant_hydrovac_settings;
  create policy tenant_hydrovac_settings_tenant_all on public.tenant_hydrovac_settings for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id))
    with check (public.current_user_can_access_tenant(tenant_id));
end $$;

do $$ begin
  drop policy if exists utility_locate_tickets_tenant_all on public.utility_locate_tickets;
  create policy utility_locate_tickets_tenant_all on public.utility_locate_tickets for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id))
    with check (public.current_user_can_access_tenant(tenant_id));
end $$;

do $$ begin
  drop policy if exists waste_manifests_tenant_all on public.waste_manifests;
  create policy waste_manifests_tenant_all on public.waste_manifests for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id))
    with check (public.current_user_can_access_tenant(tenant_id));
end $$;

do $$ begin
  drop policy if exists confined_space_permits_tenant_all on public.confined_space_permits;
  create policy confined_space_permits_tenant_all on public.confined_space_permits for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id))
    with check (public.current_user_can_access_tenant(tenant_id));
end $$;

do $$ begin
  drop policy if exists driver_qualifications_tenant_all on public.driver_qualifications;
  create policy driver_qualifications_tenant_all on public.driver_qualifications for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id))
    with check (public.current_user_can_access_tenant(tenant_id));
end $$;

do $$ begin
  drop policy if exists infrastructure_assets_tenant_all on public.infrastructure_assets;
  create policy infrastructure_assets_tenant_all on public.infrastructure_assets for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id))
    with check (public.current_user_can_access_tenant(tenant_id));
end $$;

do $$ begin
  drop policy if exists job_time_segments_tenant_all on public.job_time_segments;
  create policy job_time_segments_tenant_all on public.job_time_segments for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id))
    with check (public.current_user_can_access_tenant(tenant_id));
end $$;

do $$ begin
  drop policy if exists equipment_maintenance_log_tenant_all on public.equipment_maintenance_log;
  create policy equipment_maintenance_log_tenant_all on public.equipment_maintenance_log for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id))
    with check (public.current_user_can_access_tenant(tenant_id));
end $$;

do $$ begin
  drop policy if exists compliance_alerts_tenant_all on public.compliance_alerts;
  create policy compliance_alerts_tenant_all on public.compliance_alerts for all to authenticated
    using (public.current_user_can_access_tenant(tenant_id))
    with check (public.current_user_can_access_tenant(tenant_id));
end $$;

revoke all on table public.disposal_facilities from anon;
revoke all on table public.equipment from anon;
revoke all on table public.tenant_hydrovac_settings from anon;
revoke all on table public.utility_locate_tickets from anon;
revoke all on table public.waste_manifests from anon;
revoke all on table public.confined_space_permits from anon;
revoke all on table public.driver_qualifications from anon;
revoke all on table public.infrastructure_assets from anon;
revoke all on table public.job_time_segments from anon;
revoke all on table public.equipment_maintenance_log from anon;
revoke all on table public.compliance_alerts from anon;

grant select, insert, update, delete on table public.disposal_facilities to authenticated, service_role;
grant select, insert, update, delete on table public.equipment to authenticated, service_role;
grant select, insert, update, delete on table public.tenant_hydrovac_settings to authenticated, service_role;
grant select, insert, update, delete on table public.utility_locate_tickets to authenticated, service_role;
grant select, insert, update, delete on table public.waste_manifests to authenticated, service_role;
grant select, insert, update, delete on table public.confined_space_permits to authenticated, service_role;
grant select, insert, update, delete on table public.driver_qualifications to authenticated, service_role;
grant select, insert, update, delete on table public.infrastructure_assets to authenticated, service_role;
grant select, insert, update, delete on table public.job_time_segments to authenticated, service_role;
grant select, insert, update, delete on table public.equipment_maintenance_log to authenticated, service_role;
grant select, insert, update, delete on table public.compliance_alerts to authenticated, service_role;
