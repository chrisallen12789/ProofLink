-- ProofLink Phase 2 Schema
-- Adds project phases, deposits, multi-day bookings, inventory, file attachments,
-- vendor contacts, customer relationships, service contracts, availability blocks,
-- payment methods, and operator capacity settings.
-- Run via Supabase SQL Editor or Management API.

-- ── 1. Project phases ─────────────────────────────────────────────────────────
-- Break a single order into billable phases (e.g. deposit → rough-in → final).

CREATE TABLE IF NOT EXISTS project_phases (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id        uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  title           text        NOT NULL,
  description     text,
  phase_number    integer     NOT NULL DEFAULT 1,
  status          text        DEFAULT 'pending',  -- 'pending' | 'in_progress' | 'completed' | 'invoiced'
  amount_cents    integer     DEFAULT 0,           -- billing amount for this phase
  due_date        date,
  completed_at    timestamptz,
  invoiced_at     timestamptz,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_phases_order_idx ON project_phases (order_id);

ALTER TABLE project_phases ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "project_phases_operator_all"
    ON project_phases FOR ALL
    USING (tenant_id IN (SELECT tenant_id FROM operator_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Deposits and split payments on orders ──────────────────────────────────

ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit_amount_cents     integer DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit_paid_at          timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit_due_date         date;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS balance_due_date         date;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_schedule_notes   text;

-- ── 3. Multi-day job duration on bookings ─────────────────────────────────────

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS duration_days  integer DEFAULT 1;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_multi_day   boolean DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_walk_in     boolean DEFAULT false;

-- ── 4. Inventory / parts tracking ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_items (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  sku             text,
  description     text,
  unit            text        DEFAULT 'each',      -- 'each' | 'lb' | 'ft' | 'hr' | 'box'
  cost_cents      integer     DEFAULT 0,            -- what you pay
  price_cents     integer     DEFAULT 0,            -- what you charge
  quantity_on_hand numeric    DEFAULT 0,
  reorder_point   numeric     DEFAULT 0,
  category        text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_items_tenant_idx ON inventory_items (tenant_id);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "inventory_items_operator_all"
    ON inventory_items FOR ALL
    USING (tenant_id IN (SELECT tenant_id FROM operator_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Usage per job

CREATE TABLE IF NOT EXISTS inventory_usage (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inventory_item_id uuid        REFERENCES inventory_items(id),
  order_id          uuid        REFERENCES orders(id),
  booking_id        uuid        REFERENCES bookings(id),
  quantity_used     numeric     NOT NULL DEFAULT 1,
  unit_cost_cents   integer     DEFAULT 0,
  unit_price_cents  integer     DEFAULT 0,
  notes             text,
  used_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_usage_order_idx ON inventory_usage (order_id);

ALTER TABLE inventory_usage ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "inventory_usage_operator_all"
    ON inventory_usage FOR ALL
    USING (tenant_id IN (SELECT tenant_id FROM operator_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. File attachments ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS file_attachments (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  record_type     text        NOT NULL,  -- 'order' | 'booking' | 'customer' | 'bid'
  record_id       uuid        NOT NULL,
  file_name       text        NOT NULL,
  file_url        text        NOT NULL,
  file_size_bytes integer,
  mime_type       text,
  label           text,                  -- 'before_photo' | 'after_photo' | 'contract' | 'permit' | 'other'
  uploaded_by     uuid,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS file_attachments_record_idx ON file_attachments (record_type, record_id);

ALTER TABLE file_attachments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "file_attachments_operator_all"
    ON file_attachments FOR ALL
    USING (tenant_id IN (SELECT tenant_id FROM operator_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 6. Vendor / subcontractor contacts ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendor_contacts (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  company         text,
  email           text,
  phone           text,
  trade           text,                  -- 'electrical' | 'plumbing' | 'concrete' | etc.
  notes           text,
  is_active       boolean     DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_contacts_tenant_idx ON vendor_contacts (tenant_id);

ALTER TABLE vendor_contacts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "vendor_contacts_operator_all"
    ON vendor_contacts FOR ALL
    USING (tenant_id IN (SELECT tenant_id FROM operator_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 7. Customer relationships (family / account linking) ──────────────────────

ALTER TABLE customers ADD COLUMN IF NOT EXISTS parent_customer_id  uuid REFERENCES customers(id);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS relationship_label  text;  -- 'parent' | 'spouse' | 'student' | 'employee'

-- ── 8. Warranty / service contracts ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS service_contracts (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     uuid        REFERENCES customers(id),
  order_id        uuid        REFERENCES orders(id),
  title           text        NOT NULL,
  contract_type   text        DEFAULT 'warranty',  -- 'warranty' | 'maintenance' | 'service_plan'
  starts_at       date,
  expires_at      date,
  terms           text,
  reminder_days   integer     DEFAULT 30,           -- days before expiry to send reminder
  notified_at     timestamptz,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_contracts_customer_idx ON service_contracts (customer_id);
CREATE INDEX IF NOT EXISTS service_contracts_expiry_idx   ON service_contracts (expires_at);

ALTER TABLE service_contracts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_contracts_operator_all"
    ON service_contracts FOR ALL
    USING (tenant_id IN (SELECT tenant_id FROM operator_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 9. Availability blocks (seasonal pause / time off) ────────────────────────

CREATE TABLE IF NOT EXISTS availability_blocks (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operator_id     uuid,                             -- null = blocks whole business
  title           text,
  starts_at       date        NOT NULL,
  ends_at         date        NOT NULL,
  all_day         boolean     DEFAULT true,
  block_bookings  boolean     DEFAULT true,         -- prevent new bookings in this range
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS availability_blocks_tenant_idx ON availability_blocks (tenant_id, starts_at);

ALTER TABLE availability_blocks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "availability_blocks_operator_all"
    ON availability_blocks FOR ALL
    USING (tenant_id IN (SELECT tenant_id FROM operator_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 10. Payment method on payments (cash support) ─────────────────────────────
-- 'cash' | 'check' | 'card' | 'bank_transfer' | 'stripe' | 'venmo' | 'zelle' | 'other'

ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method   text DEFAULT 'other';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference_number text;  -- check number, transaction ID, etc.

-- ── 11. Operator capacity settings ───────────────────────────────────────────

ALTER TABLE operator_members ADD COLUMN IF NOT EXISTS max_jobs_per_day          integer;
ALTER TABLE operator_members ADD COLUMN IF NOT EXISTS default_hourly_rate_cents integer;
ALTER TABLE operator_members ADD COLUMN IF NOT EXISTS role_title                text;  -- 'lead_tech' | 'assistant' | 'driver'
