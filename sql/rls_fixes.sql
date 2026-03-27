-- RLS and index fixes for missing security policies
-- Run once in Supabase SQL editor
-- Safe to run on a fresh database; will error if policies already exist (idempotent re-run is OK to skip errors)


-- ============================================================
-- 1. processed_webhook_events: service-role only, no user access
-- ============================================================

-- Enable RLS — service role bypasses RLS automatically, so no policies
-- are needed. This simply ensures no authenticated user can query this table.
ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;

-- No policies needed — only service role accesses this table


-- ============================================================
-- 2. reviews
-- ============================================================

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_manage_reviews" ON reviews
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM operator_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "public_read_reviews" ON reviews
  FOR SELECT USING (true);


-- ============================================================
-- 3. push_subscriptions
-- ============================================================

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_manage_push_subscriptions" ON push_subscriptions
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM operator_members
      WHERE user_id = auth.uid()
    )
  );


-- ============================================================
-- 4. recurring_orders
-- ============================================================

ALTER TABLE recurring_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_manage_recurring_orders" ON recurring_orders
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM operator_members
      WHERE user_id = auth.uid()
    )
  );


-- ============================================================
-- 5. sms_messages
-- ============================================================

ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_manage_sms_messages" ON sms_messages
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM operator_members
      WHERE user_id = auth.uid()
    )
  );


-- ============================================================
-- 6. Missing indexes on FK columns (performance)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_reviews_tenant_id ON reviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_tenant_id ON push_subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recurring_orders_tenant_id ON recurring_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_tenant_id ON sms_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_id ON bookings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quotes_tenant_id ON quotes(tenant_id);
