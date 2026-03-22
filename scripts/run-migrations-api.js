'use strict';

const https = require('https');

const TOKEN = 'sbp_v0_ff39e6037fcf82427f0c56ae74dce443ff5477ae';
const REF   = 'ygfpawksbqfbgohztisv';

function apiQuery(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const req  = https.request({
      hostname: 'api.supabase.com',
      path    : `/v1/projects/${REF}/database/query`,
      method  : 'POST',
      headers : {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type' : 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const MIGRATIONS = [
  ['orders.review_requested_at',
   'ALTER TABLE orders ADD COLUMN IF NOT EXISTS review_requested_at timestamptz'],
  ['orders.source_type',
   'ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_type text'],
  ['orders.recurring_id',
   'ALTER TABLE orders ADD COLUMN IF NOT EXISTS recurring_id uuid'],
  ['orders.customer_phone',
   'ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone text'],
  ['onboarding.coupon_code',
   'ALTER TABLE tenant_onboarding_requests ADD COLUMN IF NOT EXISTS coupon_code text'],
  ['CREATE reviews',
   `CREATE TABLE IF NOT EXISTS reviews (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      tenant_id uuid, order_id uuid,
      customer_name text, customer_email text,
      rating integer CHECK (rating BETWEEN 1 AND 5),
      review_text text,
      created_at timestamptz DEFAULT now()
    )`],
  ['CREATE push_subscriptions',
   `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      operator_id uuid, tenant_id uuid,
      endpoint text, subscription jsonb,
      updated_at timestamptz DEFAULT now(),
      UNIQUE (operator_id, endpoint)
    )`],
  ['CREATE recurring_orders',
   `CREATE TABLE IF NOT EXISTS recurring_orders (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      source_order_id uuid, operator_id uuid, tenant_id uuid,
      frequency text, next_date date, active boolean DEFAULT true,
      updated_at timestamptz DEFAULT now(),
      UNIQUE (source_order_id)
    )`],
  ['CREATE bookings',
   `CREATE TABLE IF NOT EXISTS bookings (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      tenant_id uuid, operator_id uuid,
      customer_name text, customer_email text,
      title text, starts_at timestamptz, ends_at timestamptz,
      notes text, status text DEFAULT 'confirmed',
      order_id uuid,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )`],
  ['CREATE sms_messages',
   `CREATE TABLE IF NOT EXISTS sms_messages (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      tenant_id uuid, operator_id uuid,
      direction text CHECK (direction IN ('inbound','outbound')),
      from_number text, to_number text, body text,
      status text, twilio_sid text,
      customer_id uuid, order_id uuid,
      created_at timestamptz DEFAULT now()
    )`],
  ['RLS reviews',           'ALTER TABLE reviews            ENABLE ROW LEVEL SECURITY'],
  ['RLS push_subscriptions','ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY'],
  ['RLS recurring_orders',  'ALTER TABLE recurring_orders   ENABLE ROW LEVEL SECURITY'],
  ['RLS bookings',          'ALTER TABLE bookings           ENABLE ROW LEVEL SECURITY'],
  ['RLS sms_messages',      'ALTER TABLE sms_messages       ENABLE ROW LEVEL SECURITY'],
];

(async () => {
  let passed = 0, failed = 0;
  for (const [label, sql] of MIGRATIONS) {
    try {
      const { status, body } = await apiQuery(sql);
      const isErr = status >= 400 || (body && body.message && !String(body.message).includes('already exists'));
      if (isErr) {
        console.error(`\u274c  ${label} — ${JSON.stringify(body)}`);
        failed++;
      } else {
        console.log(`\u2705  ${label}`);
        passed++;
      }
    } catch (e) {
      console.error(`\u274c  ${label} — ${e.message}`);
      failed++;
    }
  }
  console.log(`\n\ud83d\udcca  Done \u2014 ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
