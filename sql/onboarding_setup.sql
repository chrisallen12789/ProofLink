-- ============================================================
-- ProofLink Onboarding System — SQL Setup
-- Run this in your Supabase SQL editor
-- ============================================================

-- 1. Create the onboarding requests table
CREATE TABLE IF NOT EXISTS tenant_onboarding_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status              TEXT NOT NULL DEFAULT 'submitted',
  business_name       TEXT NOT NULL,
  business_slug       TEXT,
  owner_name          TEXT NOT NULL,
  owner_email         TEXT NOT NULL,
  phone               TEXT,
  business_type       TEXT,
  city_state          TEXT,
  requested_subdomain TEXT,
  logo_url            TEXT,
  seed_template_key   TEXT DEFAULT 'default',
  provision_error     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at         TIMESTAMPTZ
);

-- 2. Add a check constraint on status
ALTER TABLE tenant_onboarding_requests
  DROP CONSTRAINT IF EXISTS onboarding_status_check;

ALTER TABLE tenant_onboarding_requests
  ADD CONSTRAINT onboarding_status_check
  CHECK (status IN ('submitted', 'approved', 'provisioning', 'provisioned', 'failed'));

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_onboarding_status
  ON tenant_onboarding_requests (status);

CREATE INDEX IF NOT EXISTS idx_onboarding_email
  ON tenant_onboarding_requests (owner_email);

CREATE INDEX IF NOT EXISTS idx_onboarding_slug
  ON tenant_onboarding_requests (business_slug);

CREATE INDEX IF NOT EXISTS idx_onboarding_created
  ON tenant_onboarding_requests (created_at DESC);

-- 4. Auto-update updated_at via trigger
CREATE OR REPLACE FUNCTION update_onboarding_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS onboarding_updated_at_trigger
  ON tenant_onboarding_requests;

CREATE TRIGGER onboarding_updated_at_trigger
  BEFORE UPDATE ON tenant_onboarding_requests
  FOR EACH ROW EXECUTE FUNCTION update_onboarding_updated_at();

-- 5. Row-level security (RLS) — keep consistent with existing tables
ALTER TABLE tenant_onboarding_requests ENABLE ROW LEVEL SECURITY;

-- Public inserts (anyone can submit a request)
DROP POLICY IF EXISTS "Public can submit onboarding requests"
  ON tenant_onboarding_requests;

CREATE POLICY "Public can submit onboarding requests"
  ON tenant_onboarding_requests
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (status = 'submitted');

-- Only service-role / operators may read/update (backend handles this)
DROP POLICY IF EXISTS "Service role full access"
  ON tenant_onboarding_requests;

CREATE POLICY "Service role full access"
  ON tenant_onboarding_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 6. Verify
SELECT
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_name = 'tenant_onboarding_requests'
ORDER BY ordinal_position;
