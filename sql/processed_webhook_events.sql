-- Track processed Stripe webhook events to ensure idempotency
-- Run this once in Supabase SQL editor

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processed_webhook_events_event_id
  ON processed_webhook_events(event_id);

-- Auto-delete events older than 90 days to keep table small
-- Run separately or as a scheduled job:
-- DELETE FROM processed_webhook_events WHERE processed_at < NOW() - INTERVAL '90 days';
