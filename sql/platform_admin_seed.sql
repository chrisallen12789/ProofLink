-- ============================================================
-- ProofLink — Platform Admin Seed
-- Run AFTER phase3_tenants_migration.sql
--
-- Ensures the initial platform admin identity exists in the
-- operators table.  This is safe to re-run (uses ON CONFLICT).
--
-- NOTE: The admin-verify Netlify function also performs this
-- bootstrap automatically on first login when the auth user's
-- UID matches PLATFORM_ADMIN_UID.  This script is provided
-- for manual/CI use if preferred.
-- ============================================================

-- Insert platform admin (no tenant_id — platform-level identity)
INSERT INTO operators (email, name, role, tenant_id)
VALUES (
  'christopher@prooflink.co',
  'Christopher',
  'platform_admin',
  NULL
)
ON CONFLICT (email) DO UPDATE
  SET role = 'platform_admin',
      updated_at = NOW();
