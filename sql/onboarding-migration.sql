-- ============================================================
-- ProofLink Onboarding Migration
-- Run this in Supabase SQL Editor before deploying the app
-- ============================================================

-- 1. Create the onboarding requests table
CREATE TABLE IF NOT EXISTS tenant_onboarding_requests (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  status              TEXT        NOT NULL DEFAULT 'submitted',
  business_name       TEXT        NOT NULL,
  business_slug       TEXT,
  owner_name          TEXT        NOT NULL,
  owner_email         TEXT        NOT NULL,
  phone               TEXT,
  business_type       TEXT,
  city_state          TEXT,
  requested_subdomain TEXT,
  logo_url            TEXT,
  seed_template_key   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at         TIMESTAMPTZ,
  provision_error     TEXT,

  CONSTRAINT tenant_onboarding_requests_status_check
    CHECK (status IN ('submitted','approved','provisioning','provisioned','failed'))
);

-- 2. Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_onboarding_requests_status
  ON tenant_onboarding_requests (status);

CREATE INDEX IF NOT EXISTS idx_onboarding_requests_email
  ON tenant_onboarding_requests (owner_email);

CREATE INDEX IF NOT EXISTS idx_onboarding_requests_created_at
  ON tenant_onboarding_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_onboarding_requests_slug
  ON tenant_onboarding_requests (business_slug)
  WHERE business_slug IS NOT NULL;

-- 3. Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_onboarding_updated_at ON tenant_onboarding_requests;
CREATE TRIGGER trg_onboarding_updated_at
  BEFORE UPDATE ON tenant_onboarding_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. Row Level Security
ALTER TABLE tenant_onboarding_requests ENABLE ROW LEVEL SECURITY;

-- Public can INSERT (submit a request)
CREATE POLICY "public_can_submit_onboarding"
  ON tenant_onboarding_requests
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only authenticated operators can SELECT / UPDATE
-- (Backend functions use the service role key and bypass RLS)
-- This policy guards direct client access
CREATE POLICY "authenticated_can_read_onboarding"
  ON tenant_onboarding_requests
  FOR SELECT
  TO authenticated
  USING (true);

-- 5. Verify the table was created correctly
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'tenant_onboarding_requests'
ORDER BY ordinal_position;
