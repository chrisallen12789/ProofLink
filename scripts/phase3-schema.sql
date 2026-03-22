-- ProofLink Phase 3 Schema
-- Adds recurring service plans, customer portal payments view,
-- and any missing indexes/columns from Phase 2.

-- ── Recurring Service Plans ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recurring_service_plans (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id           uuid        REFERENCES customers(id),
  name                  text        NOT NULL,
  plan_type             text        DEFAULT 'monthly',  -- 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual'
  price_cents           integer     NOT NULL DEFAULT 0,
  interval_days         integer     NOT NULL DEFAULT 30,
  next_billing_date     date,
  started_at            date        DEFAULT CURRENT_DATE,
  cancelled_at          date,
  status                text        DEFAULT 'active',   -- 'active' | 'paused' | 'cancelled'
  auto_renew            boolean     DEFAULT true,
  notes                 text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recurring_plans_tenant_idx ON recurring_service_plans (tenant_id, status);
CREATE INDEX IF NOT EXISTS recurring_plans_customer_idx ON recurring_service_plans (customer_id);
ALTER TABLE recurring_service_plans ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "recurring_plans_operator_all" ON recurring_service_plans FOR ALL
    USING (tenant_id IN (SELECT tenant_id FROM operator_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Orders: missing payment columns ───────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_paid_cents integer DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method text;  -- 'cash' | 'card' | 'check' | 'transfer'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- ── Bookings: missing status columns ──────────────────────────────────────────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_walk_in boolean DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS no_show boolean DEFAULT false;

-- ── Customers: aggregate value columns ────────────────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lifetime_value_cents integer DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_bookings integer DEFAULT 0;
