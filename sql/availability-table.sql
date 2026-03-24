-- availability table
-- Stores per-operator scheduling rules, lead time, and daily order limits.
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS availability (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         text        NOT NULL,
  operator_id       uuid        REFERENCES operators(id) ON DELETE CASCADE,
  timezone          text        NOT NULL DEFAULT 'America/New_York',
  lead_time_hours   integer     NOT NULL DEFAULT 24,
  max_orders_per_day integer    NOT NULL DEFAULT 0,
  notes             text        NOT NULL DEFAULT '',
  blackout_dates    jsonb       NOT NULL DEFAULT '[]',
  rules             jsonb       NOT NULL DEFAULT '[]',
  updated_at        timestamptz DEFAULT now(),
  created_at        timestamptz DEFAULT now(),
  UNIQUE (tenant_id, operator_id)
);

CREATE INDEX IF NOT EXISTS availability_tenant_idx ON availability (tenant_id);
CREATE INDEX IF NOT EXISTS availability_operator_idx ON availability (operator_id);

ALTER TABLE availability ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "availability_operator_all"
    ON availability FOR ALL
    USING (tenant_id IN (
      SELECT tenant_id FROM operator_members WHERE user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
