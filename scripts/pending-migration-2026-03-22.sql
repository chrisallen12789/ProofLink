-- Pending migrations — paste into Supabase SQL Editor at:
-- https://supabase.com/dashboard/project/ygfpawksbqfbgohztisv/sql/new

-- 1. Quotes: track declines
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS declined_at    timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS decline_reason text;

-- 2. Bookings: track when reminder was sent
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- 3. Customer messages (portal contact form)
CREATE TABLE IF NOT EXISTS customer_messages (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      uuid,
  customer_email text,
  customer_name  text,
  message        text,
  status         text DEFAULT 'unread',
  created_at     timestamptz DEFAULT now()
);
ALTER TABLE customer_messages ENABLE ROW LEVEL SECURITY;
