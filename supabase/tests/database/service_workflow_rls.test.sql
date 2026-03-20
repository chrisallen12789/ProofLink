begin;

create extension if not exists pgtap;

select plan(8);

insert into public.tenants (
  id, name, slug, owner_email, prooflink_plan_key, billing_status, status, active
) values
(
  '61111111-1111-1111-1111-111111111111',
  'PL Test RLS Tenant A',
  'pltest-rls-tenant-a',
  'pltest.rls.a@example.com',
  'growth',
  'active',
  'active',
  true
),
(
  '62222222-2222-2222-2222-222222222222',
  'PL Test RLS Tenant B',
  'pltest-rls-tenant-b',
  'pltest.rls.b@example.com',
  'growth',
  'active',
  'active',
  true
);

insert into public.operators (
  id, email, name, role, tenant_id
) values
(
  '63333333-3333-4333-8333-333333333331',
  'pltest.rls.operator.a@example.com',
  'PL Test RLS Operator A',
  'admin',
  '61111111-1111-1111-1111-111111111111'
),
(
  '63333333-3333-4333-8333-333333333332',
  'pltest.rls.operator.b@example.com',
  'PL Test RLS Operator B',
  'admin',
  '62222222-2222-2222-2222-222222222222'
);

insert into public.operator_members (
  operator_id, tenant_id, role, user_id
) values
(
  '63333333-3333-4333-8333-333333333331',
  '61111111-1111-1111-1111-111111111111',
  'owner',
  '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
),
(
  '63333333-3333-4333-8333-333333333332',
  '62222222-2222-2222-2222-222222222222',
  'owner',
  '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
);

insert into public.customers (
  id, tenant_id, operator_id, name, email, preferred_contact, created_at, updated_at
) values
(
  '64444444-4444-4444-8444-444444444441',
  '61111111-1111-1111-1111-111111111111',
  '63333333-3333-4333-8333-333333333331',
  'PL Test RLS Customer A',
  'pltest.rls.customer.a@example.com',
  'email',
  now(),
  now()
),
(
  '64444444-4444-4444-8444-444444444442',
  '62222222-2222-2222-2222-222222222222',
  '63333333-3333-4333-8333-333333333332',
  'PL Test RLS Customer B',
  'pltest.rls.customer.b@example.com',
  'email',
  now(),
  now()
);

insert into public.leads (
  id, tenant_id, operator_id, customer_id, status, source_type, title, summary, contact_name, contact_email, preferred_contact
) values
(
  '65555555-5555-4555-8555-555555555551',
  '61111111-1111-1111-1111-111111111111',
  '63333333-3333-4333-8333-333333333331',
  '64444444-4444-4444-8444-444444444441',
  'new',
  'sql_test',
  'Tenant A lead',
  'Only tenant A should see this',
  'Tenant A Contact',
  'pltest.rls.customer.a@example.com',
  'email'
),
(
  '65555555-5555-4555-8555-555555555552',
  '62222222-2222-2222-2222-222222222222',
  '63333333-3333-4333-8333-333333333332',
  '64444444-4444-4444-8444-444444444442',
  'new',
  'sql_test',
  'Tenant B lead',
  'Only tenant B should see this',
  'Tenant B Contact',
  'pltest.rls.customer.b@example.com',
  'email'
);

insert into public.bids (
  id, tenant_id, operator_id, lead_id, customer_id, status, profile, title, line_items, subtotal_cents, total_cents
) values
(
  '66666666-6666-4666-8666-666666666661',
  '61111111-1111-1111-1111-111111111111',
  '63333333-3333-4333-8333-333333333331',
  '65555555-5555-4555-8555-555555555551',
  '64444444-4444-4444-8444-444444444441',
  'approved',
  'pressure_washing',
  'Tenant A bid',
  '[{"id":"rls-a-line","name":"House wash","quantity":1,"unit":"job","kind":"base","unit_price_cents":10000}]'::jsonb,
  10000,
  10000
),
(
  '66666666-6666-4666-8666-666666666662',
  '62222222-2222-2222-2222-222222222222',
  '63333333-3333-4333-8333-333333333332',
  '65555555-5555-4555-8555-555555555552',
  '64444444-4444-4444-8444-444444444442',
  'approved',
  'pressure_washing',
  'Tenant B bid',
  '[{"id":"rls-b-line","name":"House wash","quantity":1,"unit":"job","kind":"base","unit_price_cents":10000}]'::jsonb,
  10000,
  10000
);

insert into public.orders (
  id, tenant_id, operator_id, customer_id, lead_id, bid_id, status, fulfillment, items, subtotal_cents, total_cents, estimated_total_cents, item_count, unpriced_count, cart_summary, customer_name, email, preferred_contact
) values
(
  '67777777-7777-4777-8777-777777777771',
  '61111111-1111-1111-1111-111111111111',
  '63333333-3333-4333-8333-333333333331',
  '64444444-4444-4444-8444-444444444441',
  '65555555-5555-4555-8555-555555555551',
  '66666666-6666-4666-8666-666666666661',
  'confirmed',
  'service',
  '[{"name":"House wash","quantity":1,"unit":"job"}]'::jsonb,
  10000,
  10000,
  10000,
  1,
  0,
  'Tenant A order',
  'PL Test RLS Customer A',
  'pltest.rls.customer.a@example.com',
  'email'
),
(
  '67777777-7777-4777-8777-777777777772',
  '62222222-2222-2222-2222-222222222222',
  '63333333-3333-4333-8333-333333333332',
  '64444444-4444-4444-8444-444444444442',
  '65555555-5555-4555-8555-555555555552',
  '66666666-6666-4666-8666-666666666662',
  'confirmed',
  'service',
  '[{"name":"House wash","quantity":1,"unit":"job"}]'::jsonb,
  10000,
  10000,
  10000,
  1,
  0,
  'Tenant B order',
  'PL Test RLS Customer B',
  'pltest.rls.customer.b@example.com',
  'email'
);

insert into public.jobs (
  id, tenant_id, operator_id, order_id, customer_id, bid_id, status, title, payment_state
) values
(
  '68888888-8888-4888-8888-888888888881',
  '61111111-1111-1111-1111-111111111111',
  '63333333-3333-4333-8333-333333333331',
  '67777777-7777-4777-8777-777777777771',
  '64444444-4444-4444-8444-444444444441',
  '66666666-6666-4666-8666-666666666661',
  'scheduled',
  'Tenant A job',
  'unpaid'
),
(
  '68888888-8888-4888-8888-888888888882',
  '62222222-2222-2222-2222-222222222222',
  '63333333-3333-4333-8333-333333333332',
  '67777777-7777-4777-8777-777777777772',
  '64444444-4444-4444-8444-444444444442',
  '66666666-6666-4666-8666-666666666662',
  'scheduled',
  'Tenant B job',
  'unpaid'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);

select is(
  (select count(*) from public.leads where tenant_id = '61111111-1111-1111-1111-111111111111'),
  1::bigint,
  'tenant A operator sees own lead'
);

select is(
  (select count(*) from public.bids where tenant_id = '62222222-2222-2222-2222-222222222222'),
  0::bigint,
  'tenant A operator cannot read tenant B bid'
);

select is(
  (select count(*) from public.jobs where tenant_id = '61111111-1111-1111-1111-111111111111'),
  1::bigint,
  'tenant A operator sees own job'
);

select throws_ok(
  $sql$
    insert into public.leads (
      tenant_id, operator_id, status, source_type, title, summary, contact_name, contact_email, preferred_contact
    ) values (
      '62222222-2222-2222-2222-222222222222',
      '63333333-3333-4333-8333-333333333331',
      'new',
      'sql_test',
      'Blocked cross-tenant lead',
      'This should be blocked',
      'Blocked',
      'blocked@example.com',
      'email'
    )
  $sql$,
  '.*(row-level security|policy).*',
  'cross-tenant lead insert is blocked'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', true);

select is(
  (select count(*) from public.leads where tenant_id = '62222222-2222-2222-2222-222222222222'),
  1::bigint,
  'tenant B operator sees own lead'
);

select is(
  (select count(*) from public.jobs where tenant_id = '61111111-1111-1111-1111-111111111111'),
  0::bigint,
  'tenant B operator cannot read tenant A job'
);

reset role;
set local role anon;

select throws_ok(
  'select count(*) from public.leads',
  '.*permission denied.*',
  'anon cannot read leads'
);

select throws_ok(
  'select count(*) from public.bids',
  '.*permission denied.*',
  'anon cannot read bids'
);

select * from finish();

rollback;
