-- ProofLink Hydrovac Extension Schema
-- Extends jobs table and adds equipment tracking for Hydrovac/Vactor operations.
-- All changes are additive. No existing columns modified.

-- ── Equipment table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           text        NOT NULL,
  operator_id         uuid        NOT NULL REFERENCES operators(id),
  name                text        NOT NULL,
  unit_number         text,
  make                text,
  model               text,
  year                integer,
  equipment_type      text        NOT NULL DEFAULT 'hydrovac',
  status              text        NOT NULL DEFAULT 'active',
  hourly_rate_cents   integer     NOT NULL DEFAULT 0,
  notes               text,
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Constraints on equipment
DO $$ BEGIN
  ALTER TABLE equipment
    ADD CONSTRAINT equipment_type_check
      CHECK (equipment_type IN ('hydrovac','vactor','jetter','combo','vacuum_truck','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE equipment
    ADD CONSTRAINT equipment_status_check
      CHECK (status IN ('active','maintenance','retired'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS equipment_tenant_idx ON equipment (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS equipment_type_idx   ON equipment (tenant_id, equipment_type);

ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "equipment_operator_all" ON equipment FOR ALL TO authenticated
    USING  (public.operator_member_tenant_access(operator_id, tenant_id))
    WITH CHECK (public.operator_member_tenant_access(operator_id, tenant_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Service role bypass
DO $$ BEGIN
  CREATE POLICY "equipment_service_role" ON equipment FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── Extend jobs table ──────────────────────────────────────────────────────────
-- Service and equipment
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS service_type               text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS equipment_id               uuid REFERENCES equipment(id);

-- Time components
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS billable_hours             numeric(8,2);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS travel_hours              numeric(8,2) DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS minimum_hours             numeric(8,2) DEFAULT 2;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS after_hours_multiplier    numeric(6,4) DEFAULT 1.0;

-- Rate snapshots (captured at job creation from equipment/member records)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hourly_truck_rate_cents    integer DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hourly_operator_rate_cents integer DEFAULT 0;

-- Mobilization
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS mobilization_fee_cents    integer DEFAULT 0;

-- Disposal
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS disposal_volume_m3        numeric(10,3);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS disposal_cost_cents       integer DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS disposal_site             text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS disposal_manifest_number  text;

-- Service type index
CREATE INDEX IF NOT EXISTS jobs_service_type_idx ON jobs (tenant_id, service_type);
CREATE INDEX IF NOT EXISTS jobs_equipment_idx     ON jobs (equipment_id);
