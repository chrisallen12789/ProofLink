-- ============================================================================
-- ProofLink — Database Diagnostic
-- Run this in Supabase SQL Editor to see exactly what you have.
-- Safe read-only — no changes made.
-- ============================================================================

-- ── 1. Onboarding requests ───────────────────────────────────────────────────
SELECT id, status, business_name, owner_email, business_slug,
       provision_error, created_at
FROM public.tenant_onboarding_requests
ORDER BY created_at DESC LIMIT 20;

-- ── 2. Tenants ───────────────────────────────────────────────────────────────
SELECT id, name, slug, owner_email, active, billing_status,
       connect_status, onboarding_request_id, created_at
FROM public.tenants
ORDER BY created_at DESC LIMIT 20;

-- ── 3. Operators ─────────────────────────────────────────────────────────────
SELECT id, email, name, role, tenant_id, created_at
FROM public.operators
ORDER BY created_at DESC LIMIT 20;

-- ── 4. Operator members ──────────────────────────────────────────────────────
SELECT om.operator_id, om.tenant_id, om.role, om.user_id, om.created_at,
       o.email AS operator_email, t.name AS tenant_name, t.slug AS tenant_slug
FROM public.operator_members om
LEFT JOIN public.operators o ON o.id = om.operator_id
LEFT JOIN public.tenants   t ON t.id::text = om.tenant_id::text
ORDER BY om.created_at DESC LIMIT 20;

-- ── 5. Auth users ────────────────────────────────────────────────────────────
SELECT id, email, created_at, last_sign_in_at, confirmed_at
FROM auth.users
ORDER BY created_at DESC LIMIT 20;

-- ── 6. Auth users with NO operator record ────────────────────────────────────
SELECT au.id AS auth_user_id, au.email, au.created_at, o.id AS operator_id
FROM auth.users au
LEFT JOIN public.operators o ON lower(o.email) = lower(au.email)
WHERE o.id IS NULL
ORDER BY au.created_at DESC;

-- ── 7. Operators with NO operator_members row ────────────────────────────────
SELECT o.id, o.email, o.role, o.tenant_id, o.created_at
FROM public.operators o
LEFT JOIN public.operator_members om ON om.operator_id = o.id
WHERE om.operator_id IS NULL
ORDER BY o.created_at DESC;

-- ── 8. Operator members with NULL user_id ────────────────────────────────────
SELECT om.operator_id, om.tenant_id, om.role, o.email AS operator_email
FROM public.operator_members om
LEFT JOIN public.operators o ON o.id = om.operator_id
WHERE om.user_id IS NULL
ORDER BY om.created_at DESC;

-- ── 9. Summary ───────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM auth.users)                             AS auth_users,
  (SELECT count(*) FROM public.operators)                       AS operators,
  (SELECT count(*) FROM public.operator_members)                AS operator_members,
  (SELECT count(*) FROM public.operator_members WHERE user_id IS NULL) AS members_unlinked,
  (SELECT count(*) FROM public.tenants)                         AS tenants,
  (SELECT count(*) FROM public.tenant_onboarding_requests)      AS onboarding_requests,
  (SELECT count(*) FROM public.tenant_onboarding_requests WHERE status = 'submitted')   AS submitted,
  (SELECT count(*) FROM public.tenant_onboarding_requests WHERE status = 'provisioned') AS provisioned;
