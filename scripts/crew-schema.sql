-- ProofLink Crew App Schema
-- Adds job photo gallery, crew time tracking, and completion fields to jobs

-- ── Job photos table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_photos (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id       uuid        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  uploaded_by  uuid,       -- operator_members.user_id
  url          text        NOT NULL,
  storage_path text,       -- Supabase Storage path for deletion
  photo_type   text        DEFAULT 'before', -- 'before' | 'after' | 'during' | 'blocker' | 'other'
  caption      text,
  taken_at     timestamptz DEFAULT now(),
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_photos_job_idx    ON job_photos (job_id);
CREATE INDEX IF NOT EXISTS job_photos_tenant_idx ON job_photos (tenant_id, created_at DESC);
ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "job_photos_operator_all" ON job_photos FOR ALL
    USING (tenant_id IN (SELECT tenant_id FROM operator_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Add completion fields to jobs ─────────────────────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS actual_start_at    timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS actual_end_at      timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completion_note    text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS blocker_note       text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS blocker_photo_url  text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS signature_data_url text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS crew_notes         text;  -- notes added by field tech
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS check_in_lat       numeric(10,7);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS check_in_lng       numeric(10,7);
