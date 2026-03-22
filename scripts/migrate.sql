-- ProofLink migrations
-- Run via: npx supabase db execute --project-ref ygfpawksbqfbgohztisv --file scripts/migrate.sql

-- Orders: extra columns
ALTER TABLE orders ADD COLUMN IF NOT EXISTS review_requested_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_type text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS recurring_id uuid;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone text;

-- Onboarding requests: coupon code column
ALTER TABLE tenant_onboarding_requests ADD COLUMN IF NOT EXISTS coupon_code text;

-- Reviews table
CREATE TABLE IF NOT EXISTS reviews (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      uuid,
  order_id       uuid,
  customer_name  text,
  customer_email text,
  rating         integer CHECK (rating BETWEEN 1 AND 5),
  review_text    text,
  created_at     timestamptz DEFAULT now()
);

-- Push subscriptions table
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  operator_id  uuid,
  tenant_id    uuid,
  endpoint     text,
  subscription jsonb,
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (operator_id, endpoint)
);

-- Recurring orders table
CREATE TABLE IF NOT EXISTS recurring_orders (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source_order_id uuid,
  operator_id     uuid,
  tenant_id       uuid,
  frequency       text,
  next_date       date,
  active          boolean DEFAULT true,
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (source_order_id)
);

-- Bookings table
CREATE TABLE IF NOT EXISTS bookings (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      uuid,
  operator_id    uuid,
  customer_name  text,
  customer_email text,
  title          text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  notes          text,
  status         text DEFAULT 'confirmed',
  order_id       uuid,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- SMS messages table
CREATE TABLE IF NOT EXISTS sms_messages (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid,
  operator_id uuid,
  direction   text CHECK (direction IN ('inbound', 'outbound')),
  from_number text,
  to_number   text,
  body        text,
  status      text,
  twilio_sid  text,
  customer_id uuid,
  order_id    uuid,
  created_at  timestamptz DEFAULT now()
);

-- Enable RLS on all new tables
ALTER TABLE reviews            ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_orders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_messages       ENABLE ROW LEVEL SECURITY;

-- RLS policies: service role bypasses RLS; anon/authenticated get no access by default
-- (app layer uses service role key for all writes, so these are correct)
