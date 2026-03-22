-- ProofLink New Features Schema
-- Adds recurring bookings, time entries, session packages, crew assignment,
-- customer address fields, order line items, compliance fields, and onboarding checklist.
-- Run via Supabase SQL Editor or Management API.

-- ── Recurring bookings ────────────────────────────────────────────────────────
-- Add to bookings table:
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS recurrence_rule text;                                -- e.g. 'WEEKLY' | 'DAILY' | 'MONTHLY' | null
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS recurrence_interval integer DEFAULT 1;               -- every N weeks/days/months
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS recurrence_end_date date;                            -- stop generating after this date
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS recurrence_parent_id uuid REFERENCES bookings(id);   -- child bookings point to parent
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS recurrence_generated boolean DEFAULT false;           -- true = auto-generated instance

-- ── Time entries ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_entries (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operator_id      uuid,
  customer_id      uuid        REFERENCES customers(id),
  order_id         uuid        REFERENCES orders(id),
  booking_id       uuid        REFERENCES bookings(id),
  description      text,
  started_at       timestamptz NOT NULL,
  ended_at         timestamptz,
  duration_minutes integer,    -- computed or manual override
  billable         boolean     DEFAULT true,
  hourly_rate_cents integer    DEFAULT 0,
  cost_cents       integer     GENERATED ALWAYS AS (
    CASE WHEN duration_minutes IS NOT NULL AND hourly_rate_cents IS NOT NULL
    THEN (duration_minutes * hourly_rate_cents / 60)::integer
    ELSE 0 END
  ) STORED,
  invoiced         boolean     DEFAULT false,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS time_entries_tenant_idx  ON time_entries (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS time_entries_order_idx   ON time_entries (order_id);
CREATE INDEX IF NOT EXISTS time_entries_customer_idx ON time_entries (customer_id);
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "time_entries_operator_all" ON time_entries FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM operator_members WHERE user_id = auth.uid()));

-- ── Session packages ──────────────────────────────────────────────────────────
-- Add columns to orders for package support:
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type text DEFAULT 'standard';  -- 'standard' | 'package' | 'retainer'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS package_sessions_total integer;      -- e.g. 10
ALTER TABLE orders ADD COLUMN IF NOT EXISTS package_sessions_used integer DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS package_valid_until date;            -- expiration
ALTER TABLE orders ADD COLUMN IF NOT EXISTS recurrence_interval_days integer;    -- for retainers: 30 = monthly
ALTER TABLE orders ADD COLUMN IF NOT EXISTS next_invoice_date date;              -- for retainers: auto-create next order

-- Track which booking consumed which package session:
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS package_order_id uuid REFERENCES orders(id); -- links to parent package order

-- ── Crew/booking assignment ───────────────────────────────────────────────────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS assigned_operator_id uuid; -- which crew member is assigned

-- ── Customer address fields ───────────────────────────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_line1 text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_line2 text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS zip text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone text;

-- Address on bookings (service location, may differ from customer address):
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_address text; -- full address string for service location

-- ── Order line items ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_line_items (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id         uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  description      text        NOT NULL,
  quantity         numeric     DEFAULT 1,
  unit_price_cents integer     DEFAULT 0,
  line_total_cents integer     GENERATED ALWAYS AS ((quantity * unit_price_cents)::integer) STORED,
  line_type        text        DEFAULT 'service', -- 'service' | 'labor' | 'parts' | 'travel' | 'discount'
  sort_order       integer     DEFAULT 0,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_line_items_order_idx ON order_line_items (order_id);
ALTER TABLE order_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "order_line_items_operator_all" ON order_line_items FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM operator_members WHERE user_id = auth.uid()));

-- ── Compliance fields on orders ───────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS permit_number text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS inspection_status text; -- 'pending' | 'passed' | 'failed' | null
ALTER TABLE orders ADD COLUMN IF NOT EXISTS license_number text;

-- ── Onboarding checklist ──────────────────────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_step integer DEFAULT 0;
