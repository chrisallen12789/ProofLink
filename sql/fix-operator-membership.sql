-- ============================================================================
-- ProofLink — Operator Membership Fix
-- Run AFTER diagnostic.sql shows you what's missing.
--
-- This fixes the "user not found" / "operator tenant mismatch" errors by:
--   1. Linking any unlinked auth users to their operator record
--   2. Creating missing operator records for provisioned tenants
--   3. Creating missing operator_members rows
--
-- SAFE: uses ON CONFLICT / DO NOTHING / WHERE guards — won't duplicate rows.
-- ============================================================================

-- ── Step 1: Link auth users to operator records by email ─────────────────────
-- Fixes: operator_members rows where user_id IS NULL
UPDATE public.operator_members om
SET user_id = au.id
FROM public.operators o
JOIN auth.users au ON lower(au.email) = lower(o.email)
WHERE om.operator_id = o.id
  AND om.user_id IS NULL;

-- ── Step 2: Create missing operator records ──────────────────────────────────
-- For tenants that were provisioned but whose operator row is missing
INSERT INTO public.operators (email, name, role, tenant_id)
SELECT
  t.owner_email,
  t.owner_name,
  'tenant_owner',
  t.id
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.operators o
  WHERE lower(o.email) = lower(t.owner_email)
)
AND t.active = true
ON CONFLICT (email) DO NOTHING;

-- ── Step 3: Create missing operator_members rows ─────────────────────────────
-- For operators that have a tenant but no membership row
INSERT INTO public.operator_members (operator_id, tenant_id, role, user_id)
SELECT
  o.id AS operator_id,
  o.tenant_id,
  'owner' AS role,
  au.id AS user_id
FROM public.operators o
LEFT JOIN auth.users au ON lower(au.email) = lower(o.email)
WHERE o.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.operator_members om
    WHERE om.operator_id = o.id
  )
ON CONFLICT (operator_id, tenant_id) DO NOTHING;

-- ── Step 4: Re-link any still-null user_ids ──────────────────────────────────
UPDATE public.operator_members om
SET user_id = au.id
FROM public.operators o
JOIN auth.users au ON lower(au.email) = lower(o.email)
WHERE om.operator_id = o.id
  AND om.user_id IS NULL;

-- ── Verify: should show 0 unlinked members after running ─────────────────────
SELECT
  (SELECT count(*) FROM public.operators)                              AS operators,
  (SELECT count(*) FROM public.operator_members)                       AS memberships,
  (SELECT count(*) FROM public.operator_members WHERE user_id IS NULL) AS unlinked_memberships,
  (SELECT count(*) FROM auth.users)                                    AS auth_users;
