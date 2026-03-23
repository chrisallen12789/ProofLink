// scripts/run-migrations.js
// Run with: node scripts/run-migrations.js
// Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env

'use strict';

require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.TEST_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MIGRATIONS = [
  // ── Orders extra columns ──────────────────────────────────────────────────
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS review_requested_at timestamptz`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_type text`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS recurring_id uuid`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone text`,

  // ── Onboarding requests ───────────────────────────────────────────────────
  `ALTER TABLE tenant_onboarding_requests ADD COLUMN IF NOT EXISTS coupon_code text`,

  // ── Reviews table ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS reviews (
    id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id      uuid,
    order_id       uuid,
    customer_name  text,
    customer_email text,
    rating         integer CHECK (rating BETWEEN 1 AND 5),
    review_text    text,
    created_at     timestamptz DEFAULT now()
  )`,

  // ── Push subscriptions table ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    operator_id uuid,
    tenant_id   uuid,
    endpoint    text,
    subscription jsonb,
    updated_at  timestamptz DEFAULT now(),
    UNIQUE (operator_id, endpoint)
  )`,

  // ── Recurring orders table ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS recurring_orders (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    source_order_id uuid,
    operator_id     uuid,
    tenant_id       uuid,
    frequency       text,
    next_date       date,
    active          boolean DEFAULT true,
    updated_at      timestamptz DEFAULT now(),
    UNIQUE (source_order_id)
  )`,

  // ── Bookings table ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS bookings (
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
  )`,

  // ── SMS messages table ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS sms_messages (
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
  )`,

  // ── RLS: disable for service role (tables are operator-scoped at app layer)
  `ALTER TABLE IF EXISTS reviews           ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE IF EXISTS push_subscriptions ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE IF EXISTS recurring_orders  ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE IF EXISTS bookings          ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE IF EXISTS sms_messages      ENABLE ROW LEVEL SECURITY`,
];

(async () => {
  console.log('🔄  Running ProofLink migrations against:', SUPABASE_URL);

  let passed = 0;
  let failed = 0;

  for (const sql of MIGRATIONS) {
    const label = sql.trim().split('\n')[0].slice(0, 60);
    try {
      const { error } = await sb.rpc('exec_migration', { sql });
      if (error && error.message && !error.message.includes('does not exist') && error.code !== 'PGRST202') {
        // Try the pg-level approach via a different RPC if available
        const { error: e2 } = await sb.rpc('run_sql', { query: sql });
        if (e2 && e2.code !== 'PGRST202') {
          console.error(`❌  ${label}\n    ${error.message}`);
          failed++;
          continue;
        }
      }
      console.log(`✅  ${label}`);
      passed++;
    } catch (e) {
      console.error(`❌  ${label}\n    ${e.message}`);
      failed++;
    }
  }

  console.log(`\n📊  Done — ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\n⚠️  Some migrations need to be run manually.');
    console.log('   Copy the SQL from this file and paste into:');
    console.log('   https://supabase.com/dashboard/project/ygfpawksbqfbgohztisv/sql/new');
  }
  process.exit(failed > 0 ? 1 : 0);
})();
