-- ============================================================
-- ProofLink — Phase 2 Migration
-- Run AFTER onboarding_setup.sql
-- ============================================================

-- 1. Add rejection_reason column
ALTER TABLE tenant_onboarding_requests
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- 2. Extend status to include 'rejected'
ALTER TABLE tenant_onboarding_requests
  DROP CONSTRAINT IF EXISTS onboarding_status_check;

ALTER TABLE tenant_onboarding_requests
  ADD CONSTRAINT onboarding_status_check
  CHECK (status IN ('submitted', 'approved', 'provisioning', 'provisioned', 'failed', 'rejected'));

-- 3. Index on rejected status for filtering
CREATE INDEX IF NOT EXISTS idx_onboarding_rejected
  ON tenant_onboarding_requests (status)
  WHERE status = 'rejected';

-- 4. Verify new column exists
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'tenant_onboarding_requests'
  AND column_name IN ('rejection_reason', 'status')
ORDER BY ordinal_position;
