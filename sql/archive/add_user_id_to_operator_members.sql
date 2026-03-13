-- Migration: Add user_id column to operator_members
-- This column links operator memberships to Supabase auth users.
-- Required by the RLS policy in PROOFLINK_TENANT_SCOPED_RLS.sql and
-- the client-side requireOperatorContext() in operator.js.
--
-- Safe to run repeatedly (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

ALTER TABLE operator_members
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_operator_members_user ON operator_members (user_id);

-- Backfill user_id from operators → auth.users by matching email.
-- This connects existing operator_members rows to their Supabase auth accounts.
UPDATE operator_members om
SET user_id = au.id
FROM operators o
JOIN auth.users au ON lower(au.email) = lower(o.email)
WHERE om.operator_id = o.id
  AND om.user_id IS NULL;
