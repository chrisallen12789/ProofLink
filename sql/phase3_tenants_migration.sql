-- ============================================================
-- ProofLink — Phase 3 Migration
-- Run AFTER phase2_migration.sql
--
-- Creates:
--   tenants                  — one row per provisioned business
--   operators                — one row per business owner / platform admin
--   operator_members         — links operators to tenants with a role
--   tenant_config            — key/value store for per-tenant site settings
--   tenant_settings          — structured branding + contact + hours record
--
-- Modifies:
--   tenant_onboarding_requests — adds needs_review status, provisioned_at column
-- ============================================================

-- ── 1. tenants ───────────────────────────────────────────────────────────────
-- Primary business record created when an onboarding request is provisioned.
-- The `name` column stores the business name (matches provision-tenant.js).

CREATE TABLE IF NOT EXISTS tenants (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT        NOT NULL,                      -- business display name
  slug                 TEXT        NOT NULL UNIQUE,               -- URL-safe identifier
  owner_email          TEXT        NOT NULL,
  owner_name           TEXT,
  business_type        TEXT,
  city_state           TEXT,
  logo_url             TEXT,
  stripe_account_id    TEXT,
  stripe_charges_enabled BOOLEAN   DEFAULT FALSE,
  onboarding_request_id UUID,                                     -- FK: tenant_onboarding_requests.id
  setup_complete       BOOLEAN     DEFAULT FALSE,
  active               BOOLEAN     DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenants_slug        ON tenants (slug);
CREATE INDEX IF NOT EXISTS idx_tenants_owner_email ON tenants (owner_email);
CREATE INDEX IF NOT EXISTS idx_tenants_active      ON tenants (active);
CREATE INDEX IF NOT EXISTS idx_tenants_created     ON tenants (created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_tenants_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenants_updated_at_trigger ON tenants;
CREATE TRIGGER tenants_updated_at_trigger
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_tenants_updated_at();

-- RLS
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on tenants" ON tenants;
CREATE POLICY "Service role full access on tenants"
  ON tenants FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- ── 2. operators ─────────────────────────────────────────────────────────────
-- One row per authenticated user who can log in to /operator/ or /admin/.
-- role values: tenant_owner | admin | platform_admin

CREATE TABLE IF NOT EXISTS operators (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT        NOT NULL UNIQUE,
  name       TEXT,
  role       TEXT        NOT NULL DEFAULT 'tenant_owner',
  tenant_id  UUID        REFERENCES tenants(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT operators_role_check
    CHECK (role IN ('tenant_owner', 'admin', 'platform_admin'))
);

CREATE INDEX IF NOT EXISTS idx_operators_email     ON operators (email);
CREATE INDEX IF NOT EXISTS idx_operators_tenant_id ON operators (tenant_id);

-- RLS
ALTER TABLE operators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on operators" ON operators;
CREATE POLICY "Service role full access on operators"
  ON operators FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- ── 3. operator_members ───────────────────────────────────────────────────────
-- Links an operator to a tenant with a specific role.
-- An operator can be a member of multiple tenants (multi-tenant operators).
-- role values: owner | manager | staff

CREATE TABLE IF NOT EXISTS operator_members (
  operator_id UUID        NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  role        TEXT        NOT NULL DEFAULT 'owner',
  invited_by  UUID        REFERENCES operators(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (operator_id, tenant_id),
  CONSTRAINT operator_members_role_check
    CHECK (role IN ('owner', 'manager', 'staff'))
);

CREATE INDEX IF NOT EXISTS idx_operator_members_tenant ON operator_members (tenant_id);

-- RLS
ALTER TABLE operator_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on operator_members" ON operator_members;
CREATE POLICY "Service role full access on operator_members"
  ON operator_members FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Convenience view matching the "operator_tenants" naming in the spec
CREATE OR REPLACE VIEW operator_tenants AS
SELECT
  om.operator_id,
  om.tenant_id,
  om.role,
  om.invited_by,
  om.created_at,
  o.email  AS operator_email,
  o.name   AS operator_name,
  t.name   AS tenant_name,
  t.slug   AS tenant_slug
FROM operator_members om
JOIN operators o ON o.id = om.operator_id
JOIN tenants   t ON t.id = om.tenant_id;


-- ── 4. tenant_config ─────────────────────────────────────────────────────────
-- Key/value store for per-tenant configuration.
-- Used by provision-tenant.js and update-tenant-config.js.

CREATE TABLE IF NOT EXISTS tenant_config (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  config_key   TEXT        NOT NULL,
  config_value TEXT,                     -- JSON serialised string
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, config_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_config_tenant ON tenant_config (tenant_id);

-- RLS
ALTER TABLE tenant_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on tenant_config" ON tenant_config;
CREATE POLICY "Service role full access on tenant_config"
  ON tenant_config FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- ── 5. tenant_settings ────────────────────────────────────────────────────────
-- Structured branding, contact, and business hours for each tenant.
-- Seeded by admin-approve-onboarding.js during provisioning.

CREATE TABLE IF NOT EXISTS tenant_settings (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  branding       JSONB       NOT NULL DEFAULT '{}',   -- {business_name, logo_url, accent_color, ...}
  contact        JSONB       NOT NULL DEFAULT '{}',   -- {email, phone, city_state, ...}
  business_hours JSONB       NOT NULL DEFAULT '{}',   -- {mon: {open, close}, ...}
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_tenant_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_settings_updated_at_trigger ON tenant_settings;
CREATE TRIGGER tenant_settings_updated_at_trigger
  BEFORE UPDATE ON tenant_settings
  FOR EACH ROW EXECUTE FUNCTION update_tenant_settings_updated_at();

-- RLS
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on tenant_settings" ON tenant_settings;
CREATE POLICY "Service role full access on tenant_settings"
  ON tenant_settings FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- ── 6. Extend onboarding status to include needs_review ───────────────────────

-- Add needs_review and provisioned_at to the onboarding requests table
ALTER TABLE tenant_onboarding_requests
  ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMPTZ;

-- Drop and recreate the constraint to include needs_review
ALTER TABLE tenant_onboarding_requests
  DROP CONSTRAINT IF EXISTS onboarding_status_check;

ALTER TABLE tenant_onboarding_requests
  ADD CONSTRAINT onboarding_status_check
  CHECK (status IN (
    'submitted',
    'needs_review',
    'approved',
    'provisioning',
    'provisioned',
    'failed',
    'rejected'
  ));

-- Index for needs_review filter
CREATE INDEX IF NOT EXISTS idx_onboarding_needs_review
  ON tenant_onboarding_requests (status)
  WHERE status = 'needs_review';


-- ── 7. Verify ────────────────────────────────────────────────────────────────

SELECT table_name, (
  SELECT count(*) FROM information_schema.columns c
  WHERE c.table_name = t.table_name
    AND c.table_schema = 'public'
) AS column_count
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_name IN (
    'tenants', 'operators', 'operator_members',
    'tenant_config', 'tenant_settings',
    'tenant_onboarding_requests'
  )
ORDER BY t.table_name;
