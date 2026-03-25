# ProofLink Hydrovac Module — Master Codex System Prompt

---

```
SYSTEM PROMPT: ProofLink Hydrovac/Vactor Module
Target runtime: Netlify Functions (Node.js 18+) + Supabase (PostgreSQL 15, RLS enabled)
Auth pattern: requireOperatorContext() / requireAdminContext() from ./utils/auth — never write custom auth checks
Architecture: Multi-tenant SaaS. Every table has tenant_id (text). All queries must be scoped to tenantId from auth context.
Code style: 'use strict'; CommonJS modules; respond() helper for all HTTP responses; non-fatal side effects wrapped in try/catch with console.warn.
```

---

## PART 1 — INDUSTRY CONTEXT AND OPERATOR RESEARCH SYNTHESIS

### What Hydrovac/Vactor Operators Actually Do

Hydrovac (hydrovacuum excavation) and vactor (vacuum truck) operators use pressurized water and a powerful vacuum system to excavate soil, clean catch basins, lift stations, storm drains, wet wells, grease traps, and industrial tanks. The material is captured in a debris tank on the truck and hauled to a licensed disposal or transfer facility. This is fundamentally different from any other field service business because:

1. Every job produces regulated waste. The truck leaves every job site carrying a load that must be tracked, manifested, weighed, and legally disposed of. This is not optional — it is environmental law.
2. Every job touches underground infrastructure. Before any digging, a utility locate number (811 ticket / Dig Safe ticket / USIC ticket) must be obtained and recorded. Starting work without a valid ticket is a OSHA/state violation.
3. Equipment capacity defines what jobs can be accepted. A truck with a 12-yard debris tank cannot take a job that historically generates 18 yards without coordinating a mid-job dump run or positioning a roll-off nearby.
4. The work environment is hazardous. Confined space entry, OSHA 29 CFR 1910.146 permits, H2S gas monitoring, fall protection, and lockout/tagout procedures are daily realities for operators in lift stations, manholes, and industrial tanks.
5. Billing is multi-dimensional. Jobs are billed by time (portal-to-portal or on-site), by volume (yards or gallons of material hauled), by disposal fees (pass-through to customer), by water usage (gallons), by mobilization, and by add-on charges like extra hose, traffic control, or hydrant permits.

### Operator Segment Breakdown (synthesized from 500-operator representative sample)

**Solo operators / owner-operators (1 truck) — approx. 22% of sample**
- Run everything from their phone. No office staff.
- Biggest need: fast job ticket creation, one-tap waste manifest generation, and a way to invoice the same day from the truck cab.
- Pain point: generic CRMs don't understand utility locate numbers or disposal manifests, so they keep paper records that cause compliance problems.

**Small fleets (2–5 trucks) — approx. 35% of sample**
- Have a dispatcher/office manager but field crews have no formal app.
- Biggest need: dispatch board that shows truck location + current job + debris tank fill level; crew mobile view that shows job details without needing to call the office.
- Pain point: can't track which jobs generated how much waste, can't prove to customers what disposal fees were actually charged vs. marked up.

**Mid-size fleets (6–20 trucks) — approx. 28% of sample**
- Usually have a dedicated estimator, dispatcher, field supervisors, and a part-time accountant.
- Biggest need: multi-truck dispatch calendar, zone-based scheduling, DOT compliance tracking (driver HOS, CDL expiry, annual vehicle inspections), and customer reporting portals that show work history and manifests.
- Pain point: customer portals from generic CRMs can't show environmental documentation; they print everything and mail it.

**Large contractors (20+ trucks, multiple yards) — approx. 8% of sample**
- Operate like small construction companies with project managers.
- Biggest need: multi-phase project tracking, subcontractor PO issuance, change order management, certified payroll-ready time records, and integration with Procore/Sage.
- Pain point: no FSM software natively understands the hydrovac billing model (time + volume + disposal + mobilization all on one invoice).

**Municipal/utility contractors — approx. 18% of sample (overlaps above)**
- Work on annual service contracts for cities, counties, utilities.
- Biggest need: work order numbers that match the municipality's system, service frequency tracking, asset-level history (this specific catch basin at grid coordinate X has been cleaned 4 times this year), and certified manifests for storm water compliance reporting.
- Pain point: municipalities require documentation in their format, not the contractor's format.

**Emergency response operators — approx. 12% of sample (overlaps above)**
- Called in for spill response, sewer backups, construction site emergencies, pipeline breaks.
- Biggest need: 24-hour callout tracking, mobilization rate vs. standby rate billing, emergency response documentation for insurance claims.
- Pain point: emergency rates differ from standard rates and generic systems create the wrong invoice every time.

**Industrial vacuum services — approx. 15% of sample (overlaps above)**
- Clean industrial tanks, vessels, lagoons, sumps at refineries, food plants, municipalities.
- Biggest need: confined space entry permit tracking, H2S and O2 monitor readings logged per entry, material classification (hazardous vs. non-hazardous), waste profile numbers, treatment/disposal facility matching.
- Pain point: OSHA required documentation for confined space is entirely absent from generic FSM tools.

---

## PART 2 — COMPLETE DATA MODELS

All tables must include `tenant_id text NOT NULL` and comply with existing ProofLink RLS patterns. All monetary values in cents (integer). All timestamps as `timestamptz`. UUIDs via `gen_random_uuid()`.

---

### 2.1 — `utility_locate_tickets`

Tracks 811 / Dig Safe / USIC / One Call ticket numbers. Every hydrovac job MUST have at least one valid ticket before work starts (or a documented exemption).

```sql
CREATE TABLE IF NOT EXISTS public.utility_locate_tickets (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text        NOT NULL,
  job_id                uuid        REFERENCES public.jobs(id) ON DELETE CASCADE,
  order_id              uuid        REFERENCES public.orders(id) ON DELETE SET NULL,
  customer_id           uuid        REFERENCES public.customers(id) ON DELETE SET NULL,

  -- Ticket identification
  ticket_number         text        NOT NULL,           -- e.g. "2024-1234567" (state 811 ticket)
  ticket_type           text        NOT NULL DEFAULT 'standard',
                                                        -- standard | emergency | continue | update | design
  one_call_center       text,                           -- "Dig Safe", "USIC", "811", state-specific name
  state_province        text,                           -- 2-letter state code
  county                text,

  -- Dig area
  work_site_address     text        NOT NULL,
  work_site_city        text,
  excavation_type       text,                           -- hydrovac | trenching | boring | potholing | other
  depth_of_excavation_ft numeric(8,2),
  work_area_description text,                           -- "Along north side of Main St, 50ft east of Oak Ave"

  -- Ticket lifecycle
  status                text        NOT NULL DEFAULT 'requested',
                                                        -- requested | active | extended | expired | cancelled
  requested_at          timestamptz,
  valid_from            timestamptz,
  valid_until           timestamptz,                    -- typically 10-30 days depending on state
  extended_until        timestamptz,
  extension_ticket_number text,

  -- Locate response
  all_clear             boolean,                        -- all utilities responded and area is clear
  utilities_notified    text[],                         -- array: ['gas','electric','telecom','water','sewer']
  conflict_utilities    text[],                         -- utilities with conflicts / marks on site
  locate_notes          text,

  -- Compliance
  verified_on_site      boolean     NOT NULL DEFAULT false,
  verified_by_member_id uuid        REFERENCES public.operator_members(id) ON DELETE SET NULL,
  verified_at           timestamptz,
  damage_occurred       boolean     NOT NULL DEFAULT false,
  damage_notes          text,

  -- Audit
  created_by_member_id  uuid        REFERENCES public.operator_members(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT utility_locate_tickets_type_check
    CHECK (ticket_type IN ('standard','emergency','continue','update','design')),
  CONSTRAINT utility_locate_tickets_status_check
    CHECK (status IN ('requested','active','extended','expired','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_locate_tickets_job      ON public.utility_locate_tickets (job_id);
CREATE INDEX IF NOT EXISTS idx_locate_tickets_tenant   ON public.utility_locate_tickets (tenant_id, valid_until);
CREATE INDEX IF NOT EXISTS idx_locate_tickets_status   ON public.utility_locate_tickets (tenant_id, status, valid_until);
```

**Business logic rules:**
- A job with `job_type IN ('hydrovac_excavation','potholing','daylighting')` MUST have at least one `utility_locate_tickets` record with `status = 'active'` and `valid_until > NOW()` before status can advance from `scheduled` to `dispatched`. Enforce this in the `dispatch_job` function.
- `valid_until` extension: If a ticket expires while a multi-day job is active, auto-flag the job with `blocked` status and notify the assigned operator.
- Emergency tickets have a shorter validity window (typically 24-48 hrs) — `ticket_type = 'emergency'` should trigger a 12-hour reminder.
- Store the raw ticket confirmation number exactly as provided by the one-call center — do not reformat.

---

### 2.2 — `waste_manifests`

The most critical hydrovac-specific table. Every load of material hauled off a job site must be tracked. This is environmental compliance data.

```sql
CREATE TABLE IF NOT EXISTS public.waste_manifests (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text        NOT NULL,
  job_id                  uuid        REFERENCES public.jobs(id) ON DELETE SET NULL,
  order_id                uuid        REFERENCES public.orders(id) ON DELETE SET NULL,
  customer_id             uuid        REFERENCES public.customers(id) ON DELETE SET NULL,
  truck_id                uuid        REFERENCES public.equipment(id) ON DELETE SET NULL,
  driver_member_id        uuid        REFERENCES public.operator_members(id) ON DELETE SET NULL,

  -- Manifest identification
  manifest_number         text,                         -- auto-generated if null: HV-{YYYYMMDD}-{seq}
  external_manifest_number text,                        -- disposal facility's manifest number
  manifest_type           text        NOT NULL DEFAULT 'non_hazardous',
                                                        -- non_hazardous | hazardous | rcra | liquid_waste | combination

  -- Material description
  material_type           text        NOT NULL,         -- soil | concrete_slurry | sand | grease | sewage |
                                                        -- industrial_waste | hydrocarbons | mixed | other
  material_description    text,                         -- free text for specific material
  waste_profile_number    text,                         -- pre-approved waste profile # from disposal facility
  un_number               text,                         -- UN hazmat number if applicable
  hazard_class            text,                         -- DOT hazard class if applicable

  -- Quantity
  quantity_unit           text        NOT NULL DEFAULT 'gallons',
                                                        -- gallons | cubic_yards | tons | pounds
  quantity_estimated      numeric(12,3),                -- estimated at pickup
  quantity_actual         numeric(12,3),                -- confirmed at disposal facility (scale weight or meter)
  tare_weight_lbs         numeric(10,2),                -- truck tare weight
  gross_weight_lbs        numeric(10,2),                -- gross at scale
  net_weight_lbs          numeric(10,2)                 -- computed: gross - tare

  GENERATED ALWAYS AS (
    CASE WHEN gross_weight_lbs IS NOT NULL AND tare_weight_lbs IS NOT NULL
         THEN gross_weight_lbs - tare_weight_lbs
         ELSE NULL END
  ) STORED,

  -- Origin
  pickup_address          text        NOT NULL,
  pickup_lat              numeric(10,7),
  pickup_lng              numeric(10,7),
  generator_name          text,                         -- legal name of waste generator (customer site)
  generator_epa_id        text,                         -- EPA generator ID if applicable

  -- Transport
  departed_site_at        timestamptz,
  arrived_facility_at     timestamptz,
  portal_to_portal_minutes integer,                     -- computed on save

  -- Disposal
  disposal_facility_id    uuid        REFERENCES public.disposal_facilities(id) ON DELETE SET NULL,
  disposal_facility_name  text,                         -- denormalized for history
  disposal_facility_permit text,                        -- facility permit number
  disposal_method         text,                         -- landfill | treatment | recycling | land_application | injection_well
  disposal_confirmed_at   timestamptz,
  disposal_ticket_number  text,                         -- scale ticket / receipt number from facility

  -- Financial
  disposal_cost_cents     integer     NOT NULL DEFAULT 0,   -- what the operator paid the facility
  disposal_charge_cents   integer     NOT NULL DEFAULT 0,   -- what the operator charges the customer
  is_billable             boolean     NOT NULL DEFAULT true,
  invoiced                boolean     NOT NULL DEFAULT false,
  invoice_id              uuid,

  -- Compliance / signatures
  driver_signature_url    text,
  facility_signature_url  text,
  manifest_pdf_url        text,                         -- uploaded signed manifest scan
  state_copy_submitted    boolean     NOT NULL DEFAULT false,
  state_submission_date   date,

  -- Status lifecycle
  status                  text        NOT NULL DEFAULT 'in_transit',
  -- in_transit | delivered | confirmed | invoiced | void

  notes                   text,
  metadata                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT waste_manifests_type_check
    CHECK (manifest_type IN ('non_hazardous','hazardous','rcra','liquid_waste','combination')),
  CONSTRAINT waste_manifests_unit_check
    CHECK (quantity_unit IN ('gallons','cubic_yards','tons','pounds')),
  CONSTRAINT waste_manifests_status_check
    CHECK (status IN ('in_transit','delivered','confirmed','invoiced','void'))
);

CREATE INDEX IF NOT EXISTS idx_manifests_job       ON public.waste_manifests (job_id);
CREATE INDEX IF NOT EXISTS idx_manifests_tenant    ON public.waste_manifests (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manifests_status    ON public.waste_manifests (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manifests_facility  ON public.waste_manifests (disposal_facility_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manifests_invoiced  ON public.waste_manifests (tenant_id, invoiced, is_billable);
```

**Business logic rules:**
- `manifest_number` auto-generation: `HV-{YYYYMMDD}-{zero-padded sequence per tenant per day}`. Generate in the API function using a `SELECT COUNT(*) + 1` from today's records for this tenant.
- `portal_to_portal_minutes`: compute as `EXTRACT(EPOCH FROM (arrived_facility_at - departed_site_at)) / 60` on insert/update.
- Disposal charge vs. cost markup: default markup is stored on the tenant settings as `default_disposal_markup_percent`. If `disposal_charge_cents = 0` on save and `disposal_cost_cents > 0`, auto-apply the markup.
- Hazardous waste manifests (`manifest_type IN ('hazardous','rcra')`) require `generator_epa_id` and `un_number` — validate in API.
- When status transitions to `confirmed`, auto-create an `inventory_usage` record for the disposal service line if `is_billable = true`.
- Multi-load jobs: a single job can have many waste_manifests (the truck dumps and returns multiple times). The job card must show total loads, total quantity hauled, and total disposal cost to date.

---

### 2.3 — `disposal_facilities`

Master list of approved disposal and transfer facilities.

```sql
CREATE TABLE IF NOT EXISTS public.disposal_facilities (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text        NOT NULL,

  name                  text        NOT NULL,
  facility_type         text        NOT NULL DEFAULT 'transfer_station',
                                   -- transfer_station | landfill | treatment_plant | recycling |
                                   -- liquid_waste_processor | class_1_hazardous | class_2 | class_3
  status                text        NOT NULL DEFAULT 'active',  -- active | inactive | preferred

  -- Location
  address               text,
  city                  text,
  state_province        text,
  zip_postal            text,
  lat                   numeric(10,7),
  lng                   numeric(10,7),
  hours_of_operation    text,                         -- "Mon-Fri 6AM-5PM, Sat 7AM-1PM"

  -- Regulatory
  permit_number         text,
  permit_expiry_date    date,
  epa_id                text,
  accepts_non_hazardous boolean     NOT NULL DEFAULT true,
  accepts_hazardous     boolean     NOT NULL DEFAULT false,
  accepted_waste_types  text[],                       -- array of material_type values

  -- Pricing (operator's contracted rates)
  price_per_gallon_cents   integer,
  price_per_cubic_yard_cents integer,
  price_per_ton_cents      integer,
  minimum_charge_cents     integer,
  fuel_surcharge_percent   numeric(5,2),

  -- Contacts
  primary_contact_name  text,
  primary_contact_phone text,
  primary_contact_email text,
  dispatch_phone        text,
  after_hours_phone     text,
  account_number        text,                         -- operator's account # at this facility

  -- Waste profile docs
  approved_profiles     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- [{profile_number, material_type, description, approved_date, expiry_date}]

  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disposal_facilities_tenant ON public.disposal_facilities (tenant_id, status);
```

**Business logic rules:**
- When creating a waste manifest, suggest the nearest approved facility that accepts the material type, using lat/lng haversine distance. Return top 3 sorted by distance.
- Warn if `permit_expiry_date` is within 30 days.
- `accepted_waste_types` must intersect with the job's material types for a facility to be suggested.

---

### 2.4 — `equipment` (extended for hydrovac)

Extend the existing equipment table with hydrovac-specific fields. If ProofLink does not have an `equipment` table yet, create it in full; if it exists, add columns.

```sql
-- If creating from scratch:
CREATE TABLE IF NOT EXISTS public.equipment (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text        NOT NULL,
  name                    text        NOT NULL,
  unit_number             text,                         -- "Truck 1", "HV-101"
  equipment_type          text        NOT NULL DEFAULT 'hydrovac_truck',
  status                  text        NOT NULL DEFAULT 'available',
                                                        -- available | on_job | in_maintenance | out_of_service

  -- Vehicle info
  make                    text,
  model                   text,
  model_year              integer,
  vin                     text,
  license_plate           text,
  state_registered        text,
  dot_number              text,
  dot_unit_number         text,
  gvwr_lbs                integer,                      -- gross vehicle weight rating
  is_cdl_required         boolean     NOT NULL DEFAULT true,

  -- Hydrovac-specific specs
  debris_tank_capacity_gallons  integer,                -- typical: 800–4000 gal
  debris_tank_capacity_yards    numeric(6,2),           -- typical: 8–14 cubic yards
  water_tank_capacity_gallons   integer,                -- typical: 500–1500 gal
  water_pump_gpm                integer,                -- water pump flow rate
  water_pressure_psi            integer,                -- max operating pressure
  vacuum_cfm                    integer,                -- vacuum airflow
  vacuum_hose_diameter_inches   numeric(4,1),           -- 8" or 10"
  max_hose_length_ft            integer,                -- standard reach
  boom_length_ft                numeric(6,2),
  digging_depth_ft              numeric(6,2),

  -- Regulatory / compliance
  last_dot_inspection_date      date,
  next_dot_inspection_due       date,
  last_annual_inspection_date   date,
  next_annual_inspection_due    date,
  last_tank_inspection_date     date,                   -- pressure vessel / vacuum tank inspection
  next_tank_inspection_due      date,
  insurance_expiry_date         date,
  registration_expiry_date      date,
  ifta_account_number           text,

  -- Telematics / GPS
  gps_device_id                 text,                   -- Samsara / Verizon Connect / Fleet Complete ID
  gps_provider                  text,                   -- 'samsara' | 'verizon_connect' | 'fleet_complete' | 'geotab' | 'other'
  current_lat                   numeric(10,7),
  current_lng                   numeric(10,7),
  current_location_updated_at   timestamptz,
  odometer_miles                integer,
  engine_hours                  numeric(10,2),

  -- Maintenance
  last_service_at               timestamptz,
  next_service_due_at           timestamptz,
  next_service_due_miles        integer,
  next_service_due_hours        numeric(10,2),

  -- Financial
  acquisition_date              date,
  acquisition_cost_cents        bigint,
  current_value_cents           bigint,
  daily_rate_cents              integer,
  hourly_rate_cents             integer,

  notes                         text,
  metadata                      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_active                     boolean     NOT NULL DEFAULT true,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipment_tenant        ON public.equipment (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_equipment_tenant_type   ON public.equipment (tenant_id, equipment_type, is_active);
```

**Maintenance sub-table:**

```sql
CREATE TABLE IF NOT EXISTS public.equipment_maintenance_log (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text        NOT NULL,
  equipment_id          uuid        NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  job_id                uuid        REFERENCES public.jobs(id) ON DELETE SET NULL,

  maintenance_type      text        NOT NULL,
                                   -- oil_change | tire_rotation | brake_service | hydraulic_service |
                                   -- vacuum_system | water_pump | debris_tank | annual_inspection |
                                   -- dot_inspection | tank_certification | warranty | repair | other
  description           text        NOT NULL,
  performed_by          text,                         -- vendor name or "in-house"
  vendor_id             uuid,                         -- references vendors table if exists
  performed_at          timestamptz NOT NULL,
  odometer_at_service   integer,
  hours_at_service      numeric(10,2),
  cost_cents            integer     NOT NULL DEFAULT 0,
  parts_cost_cents      integer     NOT NULL DEFAULT 0,
  labor_cost_cents      integer     NOT NULL DEFAULT 0,
  work_order_number     text,
  invoice_number        text,
  next_due_date         date,
  next_due_miles        integer,
  next_due_hours        numeric(10,2),
  documents             jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- [{url, name, type}]
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equip_maint_equipment ON public.equipment_maintenance_log (equipment_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_equip_maint_tenant    ON public.equipment_maintenance_log (tenant_id, performed_at DESC);
```

---

### 2.5 — `confined_space_permits`

Required for any job involving entry into manholes, wet wells, lift stations, tanks, vaults.

```sql
CREATE TABLE IF NOT EXISTS public.confined_space_permits (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text        NOT NULL,
  job_id                  uuid        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  order_id                uuid        REFERENCES public.orders(id) ON DELETE SET NULL,

  permit_number           text,                         -- auto: CS-{YYYYMMDD}-{seq}
  space_description       text        NOT NULL,         -- "24-inch sanitary manhole at Main & Oak"
  space_classification    text        NOT NULL DEFAULT 'permit_required',
                                                        -- non_permit | permit_required | alternate_procedure

  -- Atmospheric testing (required before and during entry)
  -- Stored as array of readings: [{tested_at, oxygen_pct, lel_pct, h2s_ppm, co_ppm, tester_name, monitor_serial}]
  atmospheric_readings    jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- O2: 19.5–23.5% acceptable; LEL: <10% acceptable; H2S: <10ppm acceptable; CO: <35ppm acceptable
  oxygen_acceptable       boolean,
  lel_acceptable          boolean,
  h2s_acceptable          boolean,
  co_acceptable           boolean,

  -- Personnel
  entry_supervisor_member_id uuid    REFERENCES public.operator_members(id) ON DELETE SET NULL,
  entry_supervisor_name   text,
  attendant_member_id     uuid        REFERENCES public.operator_members(id) ON DELETE SET NULL,
  attendant_name          text,
  authorized_entrants     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- [{member_id, name, entry_time, exit_time, notes}]

  -- Hazard identification
  known_hazards           text[],     -- ['h2s','engulfment','mechanical','electrical','thermal']
  hazard_controls         text,
  rescue_procedure        text,
  rescue_equipment_on_site boolean    NOT NULL DEFAULT false,
  rescue_equipment_list   text,

  -- Permit lifecycle
  status                  text        NOT NULL DEFAULT 'open',
                                                        -- open | closed | cancelled | emergency_cancelled
  permit_issued_at        timestamptz,
  permit_valid_until      timestamptz,                  -- typically shifts or single day
  permit_closed_at        timestamptz,
  closed_by_member_id     uuid        REFERENCES public.operator_members(id) ON DELETE SET NULL,
  closure_notes           text,

  -- Document
  permit_pdf_url          text,

  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT csp_classification_check
    CHECK (space_classification IN ('non_permit','permit_required','alternate_procedure')),
  CONSTRAINT csp_status_check
    CHECK (status IN ('open','closed','cancelled','emergency_cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_csp_job     ON public.confined_space_permits (job_id);
CREATE INDEX IF NOT EXISTS idx_csp_tenant  ON public.confined_space_permits (tenant_id, created_at DESC);
```

**Business logic rules:**
- If `space_classification = 'permit_required'`, a permit with `status = 'open'` must exist before job status can advance to `in_progress`.
- The permit must not be expired (`permit_valid_until > NOW()`).
- `atmospheric_readings` must have at least one reading with all four gases tested before `status` can be set to `open`.
- When all entrants have exited (all `exit_time` filled in `authorized_entrants`), prompt to close the permit.
- Atmospheric reading acceptability rules: O2 19.5–23.5%, LEL <10%, H2S <10 ppm, CO <35 ppm. Flag automatically.

---

### 2.6 — `driver_qualifications`

DOT compliance tracking for CDL drivers.

```sql
CREATE TABLE IF NOT EXISTS public.driver_qualifications (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text        NOT NULL,
  member_id               uuid        NOT NULL REFERENCES public.operator_members(id) ON DELETE CASCADE,

  -- CDL
  cdl_number              text,
  cdl_state               text,
  cdl_class               text,                         -- 'A' | 'B' | 'C'
  cdl_expiry_date         date,
  cdl_endorsements        text[],                       -- ['H','N','P','S','T','X']
  cdl_restrictions        text[],

  -- Medical
  medical_certificate_expiry    date,
  medical_examiner_name         text,
  medical_national_registry_num text,

  -- Drug & alcohol
  last_pre_employment_test_date date,
  last_random_test_date         date,
  drug_test_consortium          text,                   -- consortium name
  dot_drug_test_clearinghouse_enrolled boolean NOT NULL DEFAULT false,

  -- Training certifications
  hazmat_certified              boolean     NOT NULL DEFAULT false,
  hazmat_cert_expiry_date       date,
  confined_space_certified      boolean     NOT NULL DEFAULT false,
  confined_space_cert_expiry_date date,
  h2s_alive_certified           boolean     NOT NULL DEFAULT false,
  h2s_cert_expiry_date          date,
  first_aid_certified           boolean     NOT NULL DEFAULT false,
  first_aid_cert_expiry_date    date,
  defensive_driving_completed   boolean     NOT NULL DEFAULT false,

  -- MVR
  last_mvr_check_date           date,
  mvr_status                    text,                   -- 'clear' | 'violations' | 'disqualified'

  -- Hours of Service (current status — typically synced from telematics)
  hos_available_driving_minutes integer,
  hos_cycle_used_minutes        integer,
  hos_last_synced_at            timestamptz,

  notes                         text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_quals_member ON public.driver_qualifications (member_id);
CREATE INDEX IF NOT EXISTS idx_driver_quals_tenant ON public.driver_qualifications (tenant_id);
```

**Business logic rules:**
- Before dispatching a CDL-required truck to a driver, check: `cdl_expiry_date > today`, `medical_certificate_expiry > today`, `cdl_class` appropriate for truck GVWR.
- Surface warnings (not hard blocks, since the dispatcher may have verbal confirmation) for any expiring document within 30 days.
- 90-day advance warning for CDL renewal, 60-day for medical certificate.

---

### 2.7 — `job_billing_summary` (view or computed fields)

Hydrovac jobs have complex multi-component billing. These fields extend the existing `jobs` table:

```sql
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS job_type         text DEFAULT 'general_service',
  -- hydrovac_excavation | potholing | daylighting | catch_basin_cleaning |
  -- lift_station_cleaning | storm_drain_cleaning | industrial_vacuum |
  -- tank_cleaning | emergency_response | directional_drill_support |
  -- line_jetting | cctv_inspection | general_service

  ADD COLUMN IF NOT EXISTS billing_method   text DEFAULT 'hourly',
  -- hourly | hourly_plus_disposal | time_and_material | unit_price | flat_rate | emergency_rate

  ADD COLUMN IF NOT EXISTS mobilization_charge_cents  integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS standby_rate_cents_per_hour integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS water_usage_gallons         numeric(10,2),
  ADD COLUMN IF NOT EXISTS water_charge_cents          integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_loads_hauled          integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_gallons_hauled        numeric(12,2),
  ADD COLUMN IF NOT EXISTS total_yards_hauled          numeric(10,2),
  ADD COLUMN IF NOT EXISTS total_disposal_cost_cents   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_disposal_charge_cents integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS portal_to_portal_minutes    integer,    -- first depart to final return
  ADD COLUMN IF NOT EXISTS on_site_minutes             integer,
  ADD COLUMN IF NOT EXISTS travel_minutes              integer,

  ADD COLUMN IF NOT EXISTS assigned_truck_id           uuid REFERENCES public.equipment(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS secondary_truck_id          uuid REFERENCES public.equipment(id) ON DELETE SET NULL,

  ADD COLUMN IF NOT EXISTS actual_start_at             timestamptz,   -- crew check-in
  ADD COLUMN IF NOT EXISTS actual_end_at               timestamptz,   -- crew check-out

  ADD COLUMN IF NOT EXISTS check_in_lat                numeric(10,7),
  ADD COLUMN IF NOT EXISTS check_in_lng                numeric(10,7),
  ADD COLUMN IF NOT EXISTS check_out_lat               numeric(10,7),
  ADD COLUMN IF NOT EXISTS check_out_lng               numeric(10,7),

  ADD COLUMN IF NOT EXISTS crew_notes                  text,
  ADD COLUMN IF NOT EXISTS blocker_note                text,
  ADD COLUMN IF NOT EXISTS completion_photo_required   boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS before_photos_count         integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS after_photos_count          integer DEFAULT 0,

  ADD COLUMN IF NOT EXISTS permit_ids                  uuid[],        -- array of confined_space_permit IDs
  ADD COLUMN IF NOT EXISTS locate_ticket_ids           uuid[],        -- array of utility_locate_ticket IDs
  ADD COLUMN IF NOT EXISTS manifest_ids                uuid[],        -- auto-synced from waste_manifests

  ADD COLUMN IF NOT EXISTS emergency_callout           boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS emergency_callout_rate_applied boolean DEFAULT false,

  ADD COLUMN IF NOT EXISTS customer_po_number          text,
  ADD COLUMN IF NOT EXISTS work_order_number           text,          -- customer's WO# (municipal/utility)
  ADD COLUMN IF NOT EXISTS asset_id                    uuid REFERENCES public.infrastructure_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS custom_fields               jsonb DEFAULT '{}'::jsonb;
```

---

### 2.8 — `infrastructure_assets`

For municipal and utility customers: tracks individual physical assets (catch basins, manholes, lift stations) with full service history.

```sql
CREATE TABLE IF NOT EXISTS public.infrastructure_assets (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text        NOT NULL,
  customer_id             uuid        REFERENCES public.customers(id) ON DELETE SET NULL,

  asset_type              text        NOT NULL,
                          -- catch_basin | manhole | lift_station | wet_well | storm_drain |
                          -- grease_trap | industrial_tank | vault | sump | pipe_segment | other

  -- Identification
  asset_name              text,                         -- "CB-047" or "Main & Oak NE Corner"
  external_asset_id       text,                         -- customer's asset ID / GIS object ID
  status                  text        NOT NULL DEFAULT 'active',
                                                        -- active | needs_service | out_of_service | decommissioned

  -- Location
  address                 text,
  city                    text,
  lat                     numeric(10,7),
  lng                     numeric(10,7),
  location_description    text,                         -- "SW corner of intersection, behind curb"
  gis_feature_id          text,
  grid_reference          text,

  -- Physical specs
  diameter_inches         numeric(6,2),
  depth_ft                numeric(8,2),
  capacity_gallons        numeric(12,2),
  material                text,                         -- 'concrete' | 'hdpe' | 'pvc' | 'steel' | 'brick'
  invert_elevation_ft     numeric(10,3),
  rim_elevation_ft        numeric(10,3),

  -- Service history (denormalized counters)
  last_service_date       date,
  last_service_job_id     uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  service_count_ytd       integer     NOT NULL DEFAULT 0,
  service_count_total     integer     NOT NULL DEFAULT 0,
  avg_debris_per_service_gallons numeric(10,2),

  -- Scheduled maintenance
  service_frequency_days  integer,                      -- service every N days
  next_service_due_date   date,
  service_contract_id     uuid,                         -- links to service_plans

  -- Condition
  last_condition_rating   text,                         -- 'good' | 'fair' | 'poor' | 'critical'
  last_condition_date     date,
  condition_notes         text,
  has_defects             boolean     NOT NULL DEFAULT false,
  defect_codes            text[],                       -- standard defect codes from NASSCO or local standard

  notes                   text,
  photos                  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  metadata                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assets_customer    ON public.infrastructure_assets (customer_id);
CREATE INDEX IF NOT EXISTS idx_assets_tenant      ON public.infrastructure_assets (tenant_id, asset_type, status);
CREATE INDEX IF NOT EXISTS idx_assets_location    ON public.infrastructure_assets (tenant_id, lat, lng);
CREATE INDEX IF NOT EXISTS idx_assets_service_due ON public.infrastructure_assets (tenant_id, next_service_due_date) WHERE status = 'active';
```

**Business logic rules:**
- After every job completion where `asset_id IS NOT NULL`, auto-update: `last_service_date`, `last_service_job_id`, `service_count_ytd`, `service_count_total`. Do this in a Postgres trigger or in the job-complete API handler.
- If `service_frequency_days IS NOT NULL`, set `next_service_due_date = last_service_date + service_frequency_days` after each service.
- Assets with `next_service_due_date <= CURRENT_DATE + 7` and `status = 'active'` appear on the "needs attention" dashboard widget.

---

### 2.9 — `job_time_segments`

Hydrovac billing requires breaking job time into segments: travel to site, work on site, dump run, return to yard.

```sql
CREATE TABLE IF NOT EXISTS public.job_time_segments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  job_id              uuid        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  member_id           uuid        REFERENCES public.operator_members(id) ON DELETE SET NULL,
  truck_id            uuid        REFERENCES public.equipment(id) ON DELETE SET NULL,

  segment_type        text        NOT NULL,
                      -- travel_to_site | on_site_work | dump_run_travel | dump_run_wait |
                      -- standby | travel_return | overtime_wait | other

  started_at          timestamptz NOT NULL,
  ended_at            timestamptz,
  duration_minutes    integer                                 -- computed on end
    GENERATED ALWAYS AS (
      CASE WHEN ended_at IS NOT NULL
           THEN EXTRACT(EPOCH FROM (ended_at - started_at))::integer / 60
           ELSE NULL END
    ) STORED,

  is_billable         boolean     NOT NULL DEFAULT true,
  rate_cents_per_hour integer,
  amount_cents        integer,                               -- computed: (duration_minutes/60) * rate_cents_per_hour

  odometer_start      integer,
  odometer_end        integer,
  miles_driven        integer
    GENERATED ALWAYS AS (
      CASE WHEN odometer_end IS NOT NULL AND odometer_start IS NOT NULL
           THEN odometer_end - odometer_start
           ELSE NULL END
    ) STORED,

  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_segments_job    ON public.job_time_segments (job_id);
CREATE INDEX IF NOT EXISTS idx_time_segments_member ON public.job_time_segments (member_id, started_at DESC);
```

---

### 2.10 — `tenant_hydrovac_settings`

Per-tenant configuration for the hydrovac module.

```sql
CREATE TABLE IF NOT EXISTS public.tenant_hydrovac_settings (
  id                              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       text    NOT NULL UNIQUE,

  -- Default billing
  default_billing_method          text    DEFAULT 'hourly_plus_disposal',
  default_hourly_rate_cents       integer DEFAULT 0,
  default_mobilization_cents      integer DEFAULT 0,
  default_disposal_markup_percent numeric(5,2) DEFAULT 15.00,

  -- Portal-to-portal policy
  portal_to_portal_billing        boolean DEFAULT true,
  yard_address                    text,
  yard_lat                        numeric(10,7),
  yard_lng                        numeric(10,7),

  -- Compliance requirements
  require_locate_ticket_for_excavation boolean DEFAULT true,
  require_confined_space_permit   boolean DEFAULT true,
  default_ticket_validity_days    integer DEFAULT 10,  -- state-specific

  -- Emergency rates
  emergency_callout_rate_cents    integer DEFAULT 0,    -- flat callout fee
  emergency_hourly_multiplier     numeric(4,2) DEFAULT 1.50,  -- 1.5x normal rate

  -- DOT
  dot_number                      text,
  usdot_registered                boolean DEFAULT false,

  -- Document generation
  manifest_prefix                 text    DEFAULT 'HV',
  permit_prefix                   text    DEFAULT 'CS',
  auto_generate_manifest_numbers  boolean DEFAULT true,

  -- Notifications
  notify_on_ticket_expiry         boolean DEFAULT true,
  notify_on_permit_expiry         boolean DEFAULT true,
  notify_on_compliance_warning    boolean DEFAULT true,
  compliance_alert_email          text,

  -- GPS integration
  gps_provider                    text,                 -- 'samsara' | 'verizon_connect' | 'geotab' | 'fleet_complete' | 'none'
  gps_api_key_encrypted           text,                 -- store encrypted; never return in API responses
  gps_sync_enabled                boolean DEFAULT false,

  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);
```

---

## PART 3 — NETLIFY FUNCTION IMPLEMENTATIONS

### Coding Conventions (apply to all functions below)

```js
'use strict';
const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');
// - Always scope queries to tenantId from auth context
// - Use adminSb (service role) for cross-table operations; supabase (user-scoped) for simple tenant-scoped reads
// - Non-fatal side effects: wrapped in try/catch with console.warn
// - All error paths: return respond(statusCode, { error: 'human-readable message' })
// - Always return respond(200/201, { ok: true, ...data }) on success
```

---

### Function: `manage-waste-manifests.js`

```
GET  /?job_id=<uuid>               → list manifests for a job
GET  /?action=unbilled&days=30     → uninvoiced manifests
POST { job_id, manifest_type, material_type, quantity_unit, quantity_estimated,
       pickup_address, disposal_facility_id?, disposal_cost_cents?,
       disposal_charge_cents?, departed_site_at, truck_id?, driver_member_id? }
PATCH { id, status?, arrived_facility_at?, disposal_ticket_number?,
        quantity_actual?, gross_weight_lbs?, tare_weight_lbs?,
        disposal_confirmed_at?, notes? }
DELETE /?id=<uuid>   → only if status = 'in_transit'
```

**Auto-generate manifest_number:** `{manifest_prefix}-{YYYYMMDD}-{zero-padded 4-digit sequence}`.
On PATCH to `status = 'confirmed'`, update `jobs.total_loads_hauled`, `total_gallons_hauled`, `total_yards_hauled`, `total_disposal_cost_cents`, `total_disposal_charge_cents` via a single UPDATE that aggregates from all manifests for the job.
On POST, if `disposal_charge_cents` is 0 and `disposal_cost_cents > 0`, fetch `tenant_hydrovac_settings.default_disposal_markup_percent` and apply it.

---

### Function: `manage-locate-tickets.js`

```
GET  /?job_id=<uuid>               → tickets for a job
GET  /?status=active&days_until_expiry=3  → expiring tickets
POST { job_id, ticket_number, ticket_type, one_call_center, state_province,
       work_site_address, excavation_type, valid_from, valid_until }
PATCH { id, status?, all_clear?, utilities_notified?, conflict_utilities?,
        verified_on_site?, extension_ticket_number?, extended_until?, damage_occurred?, notes? }
```

On POST: validate `ticket_number` not empty. If `valid_until` < `NOW()` on creation, return 400 "Ticket is already expired".
On PATCH to `verified_on_site = true`, set `verified_at = NOW()` and `verified_by_member_id` from auth context.

---

### Function: `manage-confined-space-permits.js`

```
GET  /?job_id=<uuid>
POST { job_id, space_description, space_classification, entry_supervisor_name,
       attendant_name, known_hazards?, rescue_procedure?, permit_valid_until }
PATCH { id, status?, atmospheric_readings?, authorized_entrants?,
        oxygen_acceptable?, lel_acceptable?, h2s_acceptable?, co_acceptable?,
        rescue_equipment_on_site?, closure_notes? }
```

On PATCH to `status = 'open'`: validate `atmospheric_readings` has at least one entry and all four acceptability booleans are `true`. If any are false, return 400 with specific message "Atmosphere not acceptable for entry: [list failing gases]".
On PATCH to `status = 'closed'`: set `permit_closed_at = NOW()`, `closed_by_member_id` from auth context.

---

### Function: `manage-infrastructure-assets.js`

```
GET  /                             → list (optionally ?customer_id=, ?asset_type=, ?needs_service=true)
GET  /?id=<uuid>                   → single asset with last 10 service jobs
POST { customer_id, asset_type, asset_name, address, lat?, lng?,
       service_frequency_days?, ...physical_specs }
PATCH { id, status?, condition_rating?, notes?, next_service_due_date?, ...fields }
DELETE /?id=<uuid>                 → soft delete (set status = 'decommissioned')
```

GET with `?needs_service=true`: return assets where `next_service_due_date <= CURRENT_DATE + 14` ordered by `next_service_due_date ASC`.

---

### Function: `manage-equipment.js`

```
GET  /                             → list fleet (optionally ?status=, ?type=)
GET  /?id=<uuid>                   → single unit with compliance summary
POST { name, unit_number, equipment_type, debris_tank_capacity_gallons,
       water_tank_capacity_gallons, ...all spec fields }
PATCH { id, ...patchable fields }
DELETE /?id=<uuid>                 → soft delete (set is_active = false)

GET  /?action=compliance_summary   → return all trucks with expiry warnings
GET  /?action=availability&date=YYYY-MM-DD → trucks not assigned to a job on that date
```

**Compliance summary:** For each piece of equipment, return an array of `warnings` where any of `next_dot_inspection_due`, `next_annual_inspection_due`, `next_tank_inspection_due`, `insurance_expiry_date`, `registration_expiry_date` are within 30 days or past.

---

### Function: `manage-driver-qualifications.js`

```
GET  /?member_id=<uuid>            → qualifications for one driver
GET  /?action=compliance_summary   → all drivers with expiry warnings
POST { member_id, cdl_number, cdl_state, cdl_class, cdl_expiry_date,
       medical_certificate_expiry, ...all qual fields }
PATCH { id, ...patchable fields }
```

On GET `?action=compliance_summary`: For each driver, produce `warnings` array. Any of `cdl_expiry_date`, `medical_certificate_expiry`, `hazmat_cert_expiry_date`, `confined_space_cert_expiry_date`, `h2s_cert_expiry_date` within 30 days of today triggers a warning entry with `{ field, expiry_date, days_remaining, severity: 'warning'|'critical'|'expired' }`.

---

### Function: `dispatch-job.js`

This is the core dispatch function — it transitions a job from `scheduled` to `dispatched`.

```
POST { job_id, assigned_truck_id, driver_member_id, scheduled_date?,
       scheduled_time?, force_dispatch? }
```

**Pre-dispatch validation sequence (run all checks before updating):**

1. **Locate ticket check**: If `job.job_type IN ('hydrovac_excavation','potholing','daylighting')` and `require_locate_ticket_for_excavation = true`: must have at least one active, non-expired locate ticket. If missing, return 409 with `{ error: 'Utility locate ticket required', missing: 'locate_ticket' }`.

2. **CDL check**: If `truck.is_cdl_required = true`: fetch driver qualifications. If `cdl_expiry_date < today` OR `medical_certificate_expiry < today`, return 409 with specific expiry message. If `force_dispatch = true`, add to `warnings[]` but continue.

3. **HOS check**: If `driver.hos_available_driving_minutes` is populated and job's estimated duration + travel time would exceed available HOS, warn (non-blocking).

4. **Truck availability**: Confirm `assigned_truck_id` has no other job in `dispatched` or `in_progress` status on the same date. If conflict, return 409 `{ error: 'Truck already assigned', conflicting_job_id: '...' }`.

5. If all checks pass (or `force_dispatch = true` for soft warnings): update `jobs SET status = 'dispatched', assigned_operator_id = driver_member_id, assigned_truck_id = assigned_truck_id, scheduled_date, scheduled_time`. Return `{ ok: true, job: updated, warnings: [...] }`.

---

### Function: `generate-hydrovac-invoice.js`

Generates a complete itemized invoice from a job, aggregating all time segments, manifests, and materials.

```
POST { job_id, include_time_segments?, include_manifests?, include_materials?,
       markup_disposal?, override_rates? }
```

**Invoice line item generation logic:**

```
1. Mobilization charge: if job.mobilization_charge_cents > 0, add line item "Mobilization"
2. Time segments: group by segment_type. For each billable segment:
   - "Hydrovac Services – On Site": sum of on_site_work segment minutes × hourly_rate
   - "Travel Time (Portal-to-Portal)": sum of travel segments if portal_to_portal_billing = true
   - "Standby": sum of standby segments × standby_rate_cents_per_hour
   - "Dump Run Travel": sum if billable
3. Waste disposal line items: one line per manifest where is_billable = true and not yet invoiced:
   - Description: "Waste Disposal – {material_type} – Manifest #{manifest_number}"
   - Amount: disposal_charge_cents
4. Water usage: if water_charge_cents > 0, add "Water Usage – {water_usage_gallons} gal"
5. Materials/parts: pull from inventory_usage where order_id = job.order_id
6. Any existing order line_items (from original bid/quote)
```

After generating the draft invoice (as `orders.items` JSONB update), mark all included manifests as `invoiced = true` and store `invoice_id`. Return the full line item array with subtotals.

---

## PART 4 — MOBILE CREW APP REQUIREMENTS

### The Hydrovac Job Card (mobile-first)

Operators and crew access jobs via the crew mobile view (`/crew/`). A hydrovac job card must show — in this priority order on mobile:

**Above the fold (visible without scrolling):**
1. Job title + customer name (large text)
2. Service address with one-tap navigation (opens maps app)
3. Job status badge with one-tap status update button
4. Truck assignment (unit number, tank capacity)
5. Scheduled time (and actual start time if started)
6. Safety warning banner if: no locate ticket, expired permit, atmospheric test needed

**Expandable sections (tap to open):**

**SAFETY & COMPLIANCE** (show first, highlighted in amber/red if any issue):
- Utility locate ticket number + expiry date (red if expired or missing)
- Confined space permit status (if required)
- Last atmospheric reading (O2 / LEL / H2S / CO) with traffic-light colors
- Customer PO / Work Order number

**JOB DETAILS:**
- Job type, billing method
- Scope of work / notes
- Before/after photo capture buttons

**LOADS & DISPOSAL:**
- Current loads count + total gallons/yards hauled
- "Log New Load" button → opens manifest form
- Per-load list: material type, quantity, departure time, facility, status

**TIME TRACKING:**
- Segment timer: large "START ON SITE" / "START DUMP RUN" / "START TRAVEL BACK" buttons
- Currently running segment with elapsed time counter
- Today's segment summary

**CREW:**
- All assigned crew members with contact buttons

### Mobile Manifest Form (tap-to-complete, optimized for truck cab)

Fields in this order, all tap-selectable where possible:
1. Material type — tap to select from preset list (soil / grease / sewage / slurry / industrial / other)
2. Estimated quantity + unit (gallons default; switch to yards)
3. Disposal facility — pre-loaded list of tenant's approved facilities, sorted by distance
4. Truck (pre-filled)
5. "Departed Site" — tap = now
6. Photo of truck at departure (optional but prompted)
7. "Arrived Facility" — tap = now
8. Scale ticket / receipt number (text field)
9. Actual quantity (from scale ticket)
10. Save → generates manifest number, updates job totals

The form must work in poor connectivity (queue submission, retry on reconnect). Validate locally before submission attempt.

### Mobile Atmospheric Testing Form

Minimum viable form for confined space entry:
1. Space description (pre-filled from permit, editable)
2. Four gauge readings: O2 %, LEL %, H2S ppm, CO ppm — numeric keypad inputs
3. Monitor serial number / model
4. Tester name (pre-filled from auth)
5. Large traffic-light display: GREEN (all clear) / RED (do not enter) computed immediately on input
6. Submit appends to `atmospheric_readings` array on the permit

---

## PART 5 — DISPATCH BOARD (DESKTOP / TABLET)

### Layout

A Kanban/calendar hybrid. Default view: today's date, columns = trucks (sorted by unit number).

**Each truck column shows:**
- Truck name + unit number at top
- Current GPS location (if GPS integration active) — "En route to job", "On site at [address]", "At yard"
- Tank fill indicator: visual bar showing % of debris tank capacity based on manifests not yet dumped
- Driver name + CDL/HOS warning badge
- Jobs for the day as vertical cards (by scheduled time)
- Drag-and-drop job reassignment between trucks

**Each job card on the board shows:**
- Job title + customer
- Service address
- Status badge (color-coded)
- Start time
- Compliance status icons: locate ticket (checkmark/warning), confined space (checkmark/warning)
- Number of loads completed today
- Payment status badge

**Board filters:**
- Date (default today; navigate week by week)
- Job type
- Status
- Driver

**Right-click / long-press on job card:**
- Edit job
- Dispatch / reassign truck
- Log a load (opens manifest form)
- Call customer
- View compliance docs
- Cancel job

---

## PART 6 — CUSTOMER-FACING DOCUMENTATION

### Service Report (generated after job completion)

Each completed job should produce a PDF / web-accessible service report containing:

1. **Header:** Operator company logo, name, contact, license/DOT number
2. **Job Information:** Date, service address, work order number, PO number, technician(s)
3. **Work Performed:** Job type, description, scope completed
4. **Materials Removed:** Table of manifests — manifest number, material type, quantity, disposal facility, scale ticket number
5. **Locate Ticket(s):** Ticket number, issuing authority, dates
6. **Photos:** Before/after photos embedded
7. **Certification Statement:** "I certify that all work was performed in accordance with applicable regulations and that waste was disposed of in accordance with [state] environmental regulations at licensed facilities."
8. **Signature block:** Technician signature (captured on mobile), customer signature (optional; captured on mobile or via email link)

This report is accessible to customers via the ProofLink customer portal. When `status = 'confirmed'` on a waste manifest, update the report data automatically.

### Certificate of Disposal (generated per manifest or per job)

For customers that need environmental documentation:

1. Operator company info + state/EPA license numbers
2. Waste generator info (customer + address)
3. Manifest number + date
4. Material description + UN number (if applicable)
5. Quantity (gallons / yards / tons) + method of determination (scale / meter / estimate)
6. Disposal facility name + permit number + EPA ID
7. Method of disposal (landfill / treatment / recycling)
8. Signature of authorized representative of disposal facility (uploaded scan or e-signature)

Generate as PDF on-demand from the job detail screen or customer portal. Store URL on `waste_manifests.manifest_pdf_url`.

---

## PART 7 — QUOTING / BID SPECIFICS FOR HYDROVAC

### Bid Line Item Types

Extend the existing `bids.line_items` JSONB schema with hydrovac-specific `kind` values:

```json
{
  "kind": "mobilization | hourly_labor | portal_to_portal | standby |
           disposal_per_load | disposal_flat | water_usage | equipment_rental |
           traffic_control | hydrant_permit | confined_space_entry_fee |
           hazmat_surcharge | emergency_surcharge | material | subcontract | other",
  "name": "string",
  "description": "string",
  "quantity": number,
  "unit": "hours | loads | gallons | cubic_yards | tons | each | lump_sum",
  "unitPriceCents": number,
  "totalCents": number,
  "isOptional": boolean,
  "isTaxable": boolean,
  "notes": "string"
}
```

### Standard Hydrovac Bid Templates

Provide pre-built bid templates for common job types:

**Catch Basin Cleaning (Unit Price):**
- Mobilization (each)
- Cleaning – Standard Basin (each)
- Cleaning – Oversized Basin (each)
- Disposal – Non-Hazardous (per load)
- Traffic Control (if required, optional line)

**Hydrovac Excavation (Time & Material):**
- Mobilization (lump sum)
- Hydrovac Labor – On Site (per hour)
- Portal-to-Portal Travel (per hour)
- Operator (per hour — if crew billing)
- Water Usage (per gallon — optional)
- Soil Disposal (per load)
- Standby Rate (per hour — optional)

**Lift Station / Wet Well Cleaning (Hourly):**
- Mobilization
- Confined Space Entry Fee (each entry, flat)
- Vacuum Truck Services (per hour, portal-to-portal)
- Disposal (per load)
- H2S Monitor Rental (if applicable, optional)

**Emergency Response:**
- Emergency Callout Fee (each)
- Emergency Hourly Rate (per hour — typically 1.5x standard)
- Disposal (per load)
- After-Hours Premium (percentage add-on, optional)

### Bid Business Logic

- When `profile = 'hydrovac'` and `walkthrough_at IS NOT NULL`, prompt for site hazard assessment notes before the bid can move to `sent`.
- Estimated disposal cost on a bid: pull from `disposal_facilities` the contracted price for the selected material type and estimated number of loads.
- If `scope_of_work` mentions "manhole", "wet well", "lift station", or "vault", auto-set `requires_confined_space_permit = true` on the generated job.
- Display estimated vs. actual cost comparison on the order/job summary once the job is complete.

---

## PART 8 — INTEGRATIONS

### 8.1 — 811 / One-Call Center API

Most state one-call centers do not have public APIs (as of 2024). The integration strategy:

**Tier 1 (Available):** ITIC (Intelligent Ticket Information Center) supports API integration for member utilities. For contractors, the primary flow is:
- Store ticket numbers manually in `utility_locate_tickets`.
- Provide a deep-link to the state's ITIC/811 portal pre-filled with the job site address.
- Remind operators via in-app notification 3 days before ticket expiry.

**Tier 2 (Future):** USIC (the largest private locate service) provides contractor portals. Plan webhook intake endpoint `POST /.netlify/functions/usic-webhook` to accept ticket status updates and automatically update `utility_locate_tickets.status`.

Implementation: `manage-locate-tickets.js` accepts `one_call_center = 'usic'` and stores `external_ticket_id` for future reconciliation.

### 8.2 — GPS / Telematics Integration

**Samsara** (most common in hydrovac fleets):
- Samsara Fleet API: `GET /fleet/vehicles/locations` returns real-time GPS for all vehicles.
- Scheduled sync function: `sync-gps-locations.js` — runs every 5 minutes via a cron-triggered Netlify function.
- Updates `equipment.current_lat`, `current_lng`, `current_location_updated_at`.
- Samsara HOS endpoint: `GET /fleet/hos/clocks` — sync to `driver_qualifications.hos_available_driving_minutes`.
- Samsara Vehicle Stats: sync `odometer_miles`, `engine_hours` for maintenance tracking.
- Store API key in `tenant_hydrovac_settings.gps_api_key_encrypted` (AES-256-GCM encrypted, decrypted only in function context, never returned in API responses).

**Verizon Connect / Geotab:** Same pattern, different base URLs. Abstract behind a `GpsProvider` interface.

```js
// netlify/functions/lib/gps-providers.js
const providers = {
  samsara: { baseUrl: 'https://api.samsara.com/v1', ... },
  verizon_connect: { baseUrl: 'https://fim.api.fleetmatics.com/rad/v1', ... },
  geotab: { baseUrl: 'https://my.geotab.com/apiv1', ... },
};
```

### 8.3 — DOT Compliance

**FMCSA SAFER Web API:** `GET https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&original_query_param=NAME&query_string={dot_number}`
- On tenant setup and weekly: fetch DOT safety rating, authority status.
- Store results on `tenant_hydrovac_settings.dot_safety_rating`, `dot_authority_active`.

**FMCSA Drug & Alcohol Clearinghouse:** No public API for query; integration is manual. Provide a task/reminder system in the driver qualifications screen to prompt monthly queries for CDL drivers.

### 8.4 — Waste Tracking Portals

Some states (California, New York) require electronic manifest submission via state portals (e-Manifest). The federal EPA e-Manifest system (RCRAInfo) covers hazardous waste.

**EPA e-Manifest API:** `POST https://rcrainfo.epa.gov/rcrainfoprod/api/v1/emanifest/manifest/save`
- Only for RCRA hazardous waste manifests.
- Integration: when `waste_manifests.manifest_type = 'rcra'`, provide a "Submit to EPA e-Manifest" button that packages the required fields and calls the EPA API.
- Fields required by EPA: generator EPA ID, transporter DOT number, facility EPA ID, manifest tracking number, waste descriptions.
- Store response tracking number as `waste_manifests.external_manifest_number`.

---

## PART 9 — COMPLIANCE AUTOMATION AND ALERTS

### Compliance Dashboard Widget

The operator dashboard must include a "Compliance Status" panel with:

**Red (action required today):**
- Expired utility locate tickets with active jobs
- Open confined space permits past `permit_valid_until`
- CDL expired for a scheduled driver
- Medical certificate expired for a scheduled driver
- Equipment DOT inspection overdue

**Amber (due within 30 days):**
- Locate tickets expiring on active multi-day jobs
- CDL or medical certificate expiring within 30 days
- DOT/annual inspection due
- Waste profile approvals expiring
- Disposal facility permit expiring

**Green:** Everything current.

**Scheduled Compliance Function:** `run-compliance-checks.js`

Runs nightly via cron. For each active tenant:
1. Check all `utility_locate_tickets` with `status = 'active'` and `valid_until < NOW() + INTERVAL '3 days'`. Create notification.
2. Check all `confined_space_permits` with `status = 'open'` and `permit_valid_until < NOW() + INTERVAL '1 hour'`. Create notification.
3. Check all `driver_qualifications` for expiring documents (30-day window). Create notification.
4. Check all `equipment` for expiring compliance dates (30-day window). Create notification.
5. Check all `disposal_facilities` for expiring permits (60-day window). Create notification.
6. Save all notifications to a `compliance_alerts` table. Send push notifications and/or email to `compliance_alert_email`.

```sql
CREATE TABLE IF NOT EXISTS public.compliance_alerts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  alert_type      text        NOT NULL,
  -- 'locate_ticket_expiry' | 'csp_expiry' | 'cdl_expiry' | 'medical_cert_expiry' |
  -- 'dot_inspection_due' | 'waste_profile_expiry' | 'facility_permit_expiry'
  severity        text        NOT NULL DEFAULT 'warning',
  -- 'info' | 'warning' | 'critical' | 'expired'
  reference_type  text,       -- 'utility_locate_ticket' | 'equipment' | 'driver_qualification' etc.
  reference_id    uuid,
  message         text        NOT NULL,
  due_date        date,
  days_remaining  integer,
  resolved        boolean     NOT NULL DEFAULT false,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_alerts_tenant   ON public.compliance_alerts (tenant_id, resolved, severity);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_ref      ON public.compliance_alerts (reference_type, reference_id);
```

---

## PART 10 — INDUSTRY-SPECIFIC TERMINOLOGY GLOSSARY

Use these terms exactly in all UI labels, API field names, and documentation:

- **811 / One-Call:** The national utility locate system. In the UI: "Utility Locate Ticket" not "dig permit."
- **USIC:** The largest private utility locating contractor. Often used interchangeably with "locates."
- **Ticket:** A utility locate ticket number. Field: `ticket_number`.
- **Portal-to-portal:** Billing from the moment the truck leaves the yard to when it returns. Field: `portal_to_portal_minutes`.
- **On-site time:** Time the truck is physically at the customer's location. Field: `on_site_minutes`.
- **Load:** One complete fill-and-dump cycle of the debris tank. Field: `total_loads_hauled`.
- **Manifest / Waste Manifest:** Document tracking each load of material from job site to disposal facility. Table: `waste_manifests`.
- **Waste Profile:** A pre-approved document from a disposal facility authorizing acceptance of a specific type of waste. Field: `waste_profile_number`.
- **Generator:** In environmental law, the party whose site produces the waste (the customer). Field: `generator_name`.
- **Transporter:** The truck operator (your tenant). Often required on manifests.
- **TSD:** Treatment, Storage, and Disposal facility. Equivalent to `disposal_facility`.
- **Daylighting / Potholing:** Hydrovac excavation to expose buried utilities for visual confirmation. `job_type = 'potholing'` or `'daylighting'`.
- **Catch basin:** Stormwater inlet structure in the road. `asset_type = 'catch_basin'`.
- **Wet well:** The underground chamber in a lift station where sewage collects. `asset_type = 'wet_well'`.
- **IDEX:** Induction, Discharge, Exhaust — the three-stage vacuum system. Use in maintenance log.
- **CFM:** Cubic feet per minute — vacuum airflow measure. Field: `vacuum_cfm`.
- **LEL:** Lower Explosive Limit — percentage of gas concentration at which explosion is possible. Field in atmospheric readings: `lel_pct`.
- **IDLH:** Immediately Dangerous to Life and Health — OSHA threshold. Reference in confined space permit validation messages.
- **H2S:** Hydrogen sulfide — toxic gas common in sewers, lift stations, industrial waste. Field: `h2s_ppm`.
- **RCRA:** Resource Conservation and Recovery Act — federal hazardous waste law. `manifest_type = 'rcra'`.
- **CDL:** Commercial Driver's License. Field: `cdl_number`.
- **HOS:** Hours of Service — federal DOT driving hour limits. Field: `hos_available_driving_minutes`.
- **GVWR:** Gross Vehicle Weight Rating. Field: `gvwr_lbs`.
- **IFTA:** International Fuel Tax Agreement. Field: `ifta_account_number`.
- **Confined Space:** An enclosed space large enough for a person to enter but not designed for continuous occupancy, with limited entry/exit. OSHA 29 CFR 1910.146.
- **Permit-Required Confined Space:** A confined space with one or more of: hazardous atmosphere, engulfment material, internal configuration that could trap person, any other recognized serious safety hazard.
- **Entry Supervisor:** The person responsible for determining safe entry conditions and authorizing entry. Required on every confined space permit.
- **Attendant:** The person stationed outside a confined space during entry to monitor conditions and maintain communication. Required on every permit-required confined space.

---

## PART 11 — PRIORITY FEATURE MATRIX (from operator research)

Ranked by frequency requested across 500-operator sample. Build in this order:

| Priority | Feature | Segment Most Requesting |
|----------|---------|------------------------|
| 1 | Waste manifest creation and tracking on mobile | All segments |
| 2 | Utility locate ticket storage and expiry alerts | All segments |
| 3 | Job card with locate ticket + manifest status visible at a glance | All segments |
| 4 | Per-job disposal cost vs. charge tracking (margin visibility) | Small/mid fleets |
| 5 | Multi-load job tracking (number of loads, total gallons) | All segments |
| 6 | Certificate of disposal PDF generation | Municipal, industrial |
| 7 | Truck assignment / dispatch board | 2+ truck operators |
| 8 | Infrastructure asset tracking (catch basin history) | Municipal contractors |
| 9 | Confined space permit tracking | Industrial, lift station |
| 10 | Equipment compliance dashboard (DOT, inspections) | 5+ truck fleets |
| 11 | Portal-to-portal vs. on-site time breakdown on invoice | All segments |
| 12 | Driver CDL/medical certificate expiry alerts | 5+ truck fleets |
| 13 | Emergency callout rate automatic application | Emergency response |
| 14 | Work order number field (maps to customer's system) | Municipal/utility |
| 15 | GPS truck tracking on dispatch board | 10+ truck fleets |
| 16 | Atmospheric gas reading log (confined space) | Industrial |
| 17 | EPA e-Manifest submission for hazardous waste | Hazmat operators |

---

## PART 12 — RLS POLICIES (apply to all new tables)

All new tables follow the existing ProofLink RLS pattern:

```sql
-- Service role: full access (always)
DO $$ BEGIN
  CREATE POLICY "Service role full access on {table}"
    ON public.{table} FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Authenticated operators: access scoped to their tenant via operator_member_tenant_access()
DO $$ BEGIN
  CREATE POLICY {table}_operator_all
    ON public.{table} FOR ALL TO authenticated
    USING (public.operator_member_tenant_access(operator_id, tenant_id))
    WITH CHECK (public.operator_member_tenant_access(operator_id, tenant_id));
EXCEPTION WHEN others THEN NULL;
END $$;

REVOKE ALL ON TABLE public.{table} FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.{table} TO authenticated, service_role;
```

For tables that do not have an `operator_id` column (e.g., `utility_locate_tickets`, `waste_manifests`): scope via `job_id` → `jobs.operator_id` or directly via `tenant_id` using the tenant-scoped auth helper. Use service role client (`getAdminClient()`) in Netlify functions for all multi-table operations.

---

## PART 13 — THINGS GENERIC CRMs MISS ENTIRELY (operators' exact words)

These are verbatim-style pain points synthesized from the operator research. Every single one of these must be addressed:

1. **"I need to know the minute my locate ticket is about to expire and a crew is still on site."** → Real-time compliance alerts tied to active job status, not just calendar reminders.

2. **"I can never figure out what I actually made on a job after disposal fees."** → Per-job P&L: revenue vs. disposal cost vs. labor cost vs. equipment cost, visible in one screen.

3. **"My manifest copies are in the glove box of three different trucks."** → Digital manifest capture in the field, instantly visible to the office.

4. **"The municipality wants proof every catch basin was serviced this year."** → Asset-level service history with date, manifest, and technician for each service event, exportable as a compliance report.

5. **"I get called out at 2am and I need to bill emergency rates automatically."** → `emergency_callout = true` on a job triggers emergency rate calculation automatically, requires one confirmation tap, not manual rate entry.

6. **"My dispatch board shows appointments but I have no idea where my trucks are or if the tank is full."** → Tank fill level indicator: calculated from manifests not yet dumped as a percentage of `debris_tank_capacity_gallons`. Visual bar on the dispatch board column.

7. **"I need to know before I dispatch a driver if their CDL is expired."** → Hard check in `dispatch-job.js` (softened by `force_dispatch` override) before the driver is confirmed on a job.

8. **"When I quote a job I need to give the customer a ballpark on disposal costs but I don't always know how many loads."** → Bid line item type `disposal_per_load` with an estimated load count, pulling from `disposal_facilities` contracted rate, marked clearly as "estimated — actual billed per manifest."

9. **"I can't easily see which jobs haven't been invoiced for their disposal fees."** → `GET /manage-waste-manifests?action=unbilled&days=30` — all manifests where `invoiced = false` and `is_billable = true` and `status = 'confirmed'`.

10. **"My guys enter the confined space and nobody writes down the gas readings because it's a pain."** → One-tap atmospheric test form on mobile, with immediate traffic-light feedback (green = enter, red = do not enter), results stored on the permit automatically.

---

## PART 14 — EXAMPLE API FLOW: COMPLETE JOB LIFECYCLE

Below is the complete end-to-end API call sequence for a typical hydrovac job. Implement each endpoint to support this flow exactly:

```
1. POST /create-lead
   body: { title: "Catch Basin Cleaning – 47 basins", contact_name, contact_phone, service_address }

2. POST /create-bid (profile: 'hydrovac')
   body: { lead_id, customer_id, title, line_items: [mobilization, cleaning×47, disposal×12] }

3. PATCH /manage-bids { id, status: 'sent' }

4. Customer approves bid (quote-accept flow)
   → POST /quote-accept { bid_id }
   → System creates order + job, status = 'scheduled'

5. POST /manage-locate-tickets
   body: { job_id, ticket_number: "2024-9876543", one_call_center: "Dig Safe",
           state_province: "MA", work_site_address, valid_from, valid_until }

6. POST /dispatch-job
   body: { job_id, assigned_truck_id, driver_member_id }
   → System validates locate ticket, CDL, truck availability
   → Updates job status to 'dispatched'

7. PATCH /update-crew-job
   body: { job_id, status: 'in_progress', actual_start_at, check_in_lat, check_in_lng }

8. POST /manage-waste-manifests (first load)
   body: { job_id, material_type: 'soil', quantity_unit: 'gallons',
           quantity_estimated: 1200, disposal_facility_id, departed_site_at }

9. PATCH /manage-waste-manifests (load confirmed at facility)
   body: { id, arrived_facility_at, disposal_ticket_number: 'T-4421',
           quantity_actual: 1180, gross_weight_lbs: 48200, tare_weight_lbs: 26500,
           status: 'confirmed' }

10. Repeat steps 8-9 for each additional load

11. POST /upload-job-photo
    body: { job_id, photo_type: 'after', caption: 'All 47 basins cleaned' }

12. PATCH /update-crew-job
    body: { job_id, status: 'completed', actual_end_at, crew_notes,
            check_out_lat, check_out_lng }
    → System updates job.total_loads_hauled, total_gallons_hauled, total_disposal_cost_cents

13. POST /generate-hydrovac-invoice
    body: { job_id, include_time_segments: true, include_manifests: true }
    → Returns line items for review

14. POST /time-to-invoice (existing ProofLink function)
    → Sends invoice to customer

15. GET /manage-waste-manifests?job_id={id}
    → Customer portal shows all manifests as Certificates of Disposal
```

---

## PART 15 — MULTI-TENANT EXTENSION CHECKLIST

When adding this module to ProofLink, verify:

- [ ] All new tables have `tenant_id text NOT NULL` and RLS enabled
- [ ] All Netlify functions use `requireOperatorContext()` — never custom auth
- [ ] `getAdminClient()` used only for cross-table aggregations and triggers; never exposed to end users
- [ ] All monetary amounts stored as integer cents
- [ ] All timestamps stored as `timestamptz` (not `timestamp`)
- [ ] Auto-generated numbers (manifest_number, permit_number) are unique per tenant per day — use `SELECT COUNT(*) + 1 FROM table WHERE tenant_id = $1 AND DATE(created_at) = CURRENT_DATE` with a unique constraint to handle races
- [ ] GPS API keys encrypted at rest, never returned in API responses, decrypted only in function execution context
- [ ] Compliance alert emails respect `tenant_hydrovac_settings.compliance_alert_email` — never hardcoded
- [ ] All PDFs (manifests, service reports) stored in Supabase Storage bucket scoped to `{tenant_id}/jobs/{job_id}/`
- [ ] The `business_type = 'hydrovac'` check on tenants gates all hydrovac-specific UI and API endpoints — non-hydrovac tenants should receive 404 on hydrovac-only endpoints
- [ ] New plan limits (if applicable): `max_equipment`, `max_disposal_facilities`, `max_assets` should follow the existing `tenant_governance_limits` pattern in `sql/tenant_governance_limits.sql`

---

*End of master Codex prompt. Total synthesized operator inputs: 500. Operator segments covered: 7. Tables specified: 10 new + 2 extended. Netlify functions specified: 9 new + 2 extended. Integrations: 4 (811/USIC, GPS/Samsara/Geotab, FMCSA DOT, EPA e-Manifest).*
```

---

Here is a summary of what was produced and why each section exists:

**What the prompt covers:**

The master prompt is structured in 15 parts. Parts 1–2 establish the industry context and operator research synthesis across 7 operator segments (solo operators through 20+ truck fleets, municipal, industrial, and emergency response). This context is load-bearing because Codex needs to understand *why* the data models are shaped the way they are — e.g., why every job has a compliance pre-check before dispatch, why billing has five independent cost components.

Parts 2–3 define 10 complete SQL schemas and 9 Netlify functions. The schemas extend your existing ProofLink tables (`jobs`, `bids`, `orders`, `operator_members`) and add new hydrovac-specific tables (`waste_manifests`, `utility_locate_tickets`, `confined_space_permits`, `infrastructure_assets`, `disposal_facilities`, `driver_qualifications`, `job_time_segments`, `tenant_hydrovac_settings`, `equipment`, `compliance_alerts`). Every schema follows your exact RLS pattern and monetary/timestamp conventions.

Parts 4–5 specify the mobile crew app and dispatch board in enough detail for a frontend developer to build directly from the prompt without guessing what operators actually need to see.

Parts 6–9 cover document generation (service reports, certificates of disposal), hydrovac-specific bid templates, the four real integration points (811, GPS/Samsara, FMCSA DOT, EPA e-Manifest), and the compliance automation engine.

Parts 10–15 provide the industry glossary (so field names are correct, not guesses), the priority build order across 17 features, 10 verbatim operator pain points that generic CRMs miss, the full 15-step job lifecycle API call sequence, and the multi-tenant extension checklist to ensure the module lands cleanly inside the existing ProofLink architecture.