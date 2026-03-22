-- ProofLink AI Agent Schema
-- Phase 1: Audit logging and briefing persistence
-- Run via Supabase SQL Editor or Management API

-- ── Agent audit events ────────────────────────────────────────────────────────
-- Every meaningful agent interaction is logged here.
-- Supports debugging, trust, compliance, and product improvement.

CREATE TABLE IF NOT EXISTS agent_audit_events (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operator_id      uuid,
  mode             text        NOT NULL, -- 'brief' | 'copilot' | 'draft:invoice_followup' | etc.
  prompt_summary   text,                 -- Short description of user intent (max 500 chars)
  tools_used       text[],               -- Array of tool names called
  response_summary text,                 -- First 1000 chars of response
  action_proposals jsonb,                -- Any proposed write actions (for later phases)
  error            text,                 -- Error message if run failed
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_audit_events_tenant_idx ON agent_audit_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_audit_events_operator_idx ON agent_audit_events (operator_id, created_at DESC);

-- RLS: operators can read their own tenant's audit events
ALTER TABLE agent_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "agent_audit_operator_read"
  ON agent_audit_events FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM operators WHERE user_id = auth.uid()
    )
  );

-- Service role can insert (used by Netlify functions via admin client)
CREATE POLICY IF NOT EXISTS "agent_audit_service_insert"
  ON agent_audit_events FOR INSERT
  WITH CHECK (true); -- admin client bypasses RLS anyway

-- ── Agent saved notes ─────────────────────────────────────────────────────────
-- Low-risk write: operators can save notes from the AI onto records.
-- Deferred to Phase 3.

CREATE TABLE IF NOT EXISTS agent_notes (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operator_id  uuid,
  record_type  text,       -- 'order' | 'customer' | 'booking' | 'quote'
  record_id    uuid,
  note_text    text        NOT NULL,
  source       text        DEFAULT 'ai', -- 'ai' | 'operator'
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_notes_tenant_idx ON agent_notes (tenant_id, record_type, record_id);

ALTER TABLE agent_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "agent_notes_operator_all"
  ON agent_notes FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM operators WHERE user_id = auth.uid()
    )
  );

-- ── Bids table: add status column if missing ──────────────────────────────────
ALTER TABLE bids ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft';
