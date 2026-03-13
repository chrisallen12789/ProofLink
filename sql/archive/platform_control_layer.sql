-- ============================================================================
-- ProofLink Platform Control Layer — SQL Migration
-- Run AFTER governance-migration.sql
-- Safe to re-run: all operations use IF NOT EXISTS / additive patterns.
-- ============================================================================

-- ── 1. Ensure tenants table has all required lifecycle columns ──────────────
-- These columns may already exist from governance-migration.sql.
-- Re-adding with IF NOT EXISTS is safe.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS status            text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS conduct_action    text,
  ADD COLUMN IF NOT EXISTS conduct_reason    text,
  ADD COLUMN IF NOT EXISTS conduct_notes     text,
  ADD COLUMN IF NOT EXISTS conduct_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS conduct_updated_by uuid,
  ADD COLUMN IF NOT EXISTS flagged_at        timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_at      timestamptz,
  ADD COLUMN IF NOT EXISTS terminated_at     timestamptz;

-- Ensure status constraint includes all lifecycle states
DO $$ BEGIN
  ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE tenants
  ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('provisioning','active','flagged','suspended','terminated','inactive'));

-- Backfill: existing rows with no status get 'active' or 'inactive'
UPDATE tenants
  SET status = CASE WHEN active = false THEN 'inactive' ELSE 'active' END
  WHERE status IS NULL;

-- ── 2. Ensure tenant_conduct_log exists ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_conduct_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action       text NOT NULL CHECK (action IN ('flag','suspend','reinstate','terminate')),
  reason_code  text,
  admin_notes  text,
  performed_by uuid,
  performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_conduct_log_tenant_idx ON tenant_conduct_log(tenant_id);
CREATE INDEX IF NOT EXISTS tenant_conduct_log_at_idx ON tenant_conduct_log(performed_at DESC);

-- ── 3. Ensure governance rule tables exist ──────────────────────────────────

CREATE TABLE IF NOT EXISTS pl_reserved_slugs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE,
  reason     text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pl_banned_keywords (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword    text NOT NULL,
  category   text NOT NULL,
  verdict    text NOT NULL DEFAULT 'REJECT' CHECK (verdict IN ('REJECT','FLAG')),
  active     boolean NOT NULL DEFAULT true,
  notes      text,
  created_at timestamptz DEFAULT now(),
  created_by uuid
);

CREATE TABLE IF NOT EXISTS pl_protected_brands (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  active     boolean NOT NULL DEFAULT true,
  notes      text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pl_prohibited_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  keywords   text[] NOT NULL,
  verdict    text NOT NULL DEFAULT 'REJECT' CHECK (verdict IN ('REJECT','FLAG')),
  notes      text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ── 4. Rate limit tracking table (optional, for persistent rate limiting) ───
-- Currently rate limiting uses in-memory counters per function instance.
-- This table provides a persistent fallback for future use.

CREATE TABLE IF NOT EXISTS pl_rate_limits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text NOT NULL,
  count      integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now(),
  window_ms  integer NOT NULL DEFAULT 60000,
  created_at timestamptz DEFAULT now(),
  UNIQUE(key, window_start)
);

-- ── 5. Abuse monitor scan log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pl_abuse_scans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scanned    integer NOT NULL DEFAULT 0,
  flagged    integer NOT NULL DEFAULT 0,
  details    jsonb,
  scanned_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pl_abuse_scans_at_idx ON pl_abuse_scans(scanned_at DESC);

-- ── 6. Additional indexes for performance ───────────────────────────────────
CREATE INDEX IF NOT EXISTS tenants_status_idx ON tenants(status);
CREATE INDEX IF NOT EXISTS tenants_owner_email_idx ON tenants(owner_email);
CREATE INDEX IF NOT EXISTS tenants_slug_unique_idx ON tenants(slug);
CREATE INDEX IF NOT EXISTS tenants_created_at_idx ON tenants(created_at DESC);

-- ── 7. RLS policies for new tables ──────────────────────────────────────────
ALTER TABLE pl_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_abuse_scans ENABLE ROW LEVEL SECURITY;

-- Service role has full access (already implicit), add admin read for scans
DO $$ BEGIN
  CREATE POLICY "Admins can read abuse scans"
    ON pl_abuse_scans FOR SELECT
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Done ────────────────────────────────────────────────────────────────────
-- Summary:
-- - Ensured tenants lifecycle columns and constraints
-- - Ensured tenant_conduct_log table
-- - Ensured all governance rule tables (pl_reserved_slugs, pl_banned_keywords,
--   pl_protected_brands, pl_prohibited_categories)
-- - Created pl_rate_limits for persistent rate limiting
-- - Created pl_abuse_scans for audit trail of abuse monitoring runs
-- - Added performance indexes on tenants table
-- - Configured RLS on new tables
