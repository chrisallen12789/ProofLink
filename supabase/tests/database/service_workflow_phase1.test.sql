begin;

create extension if not exists pgtap;

select plan(17);

insert into public.tenants (
  id, name, slug, owner_email, prooflink_plan_key, billing_status, status, active
) values (
  '11111111-1111-1111-1111-111111111111',
  'PL Test Service Workflow SQL',
  'pltest-service-workflow-sql',
  'pltest.service.workflow.sql@example.com',
  'growth',
  'active',
  'active',
  true
);

insert into public.operators (
  id, email, name, role, tenant_id
) values (
  '22222222-2222-2222-2222-222222222222',
  'pltest.service.workflow.operator@example.com',
  'PL Test Service Workflow Operator',
  'admin',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.operator_members (
  operator_id, tenant_id, role, user_id
) values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'owner',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
);

insert into public.customers (
  id, tenant_id, operator_id, name, email, phone, preferred_contact, service_address, created_at, updated_at
) values (
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'PL Test SQL Customer',
  'pltest.service.workflow.customer@example.com',
  '555-100-2000',
  'email',
  '101 SQL Test Way, Detroit, MI',
  now(),
  now()
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);

insert into public.leads (
  id,
  tenant_id,
  operator_id,
  customer_id,
  status,
  source_type,
  title,
  summary,
  requested_service_type,
  service_address,
  contact_name,
  contact_email,
  contact_phone,
  preferred_contact,
  notes,
  metadata
) values (
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'new',
  'sql_test',
  'SQL workflow lead',
  'Pressure washing request from pgTAP',
  'Pressure washing',
  '101 SQL Test Way, Detroit, MI',
  'PL Test Contact',
  'pltest.service.workflow.customer@example.com',
  '555-100-2000',
  'email',
  'Lead created in SQL test',
  '{"source":"pgtap"}'::jsonb
);

select ok(
  exists(select 1 from public.leads where id = '44444444-4444-4444-8444-444444444444'),
  'lead creation inserts correctly'
);

select is(
  (select tenant_id from public.leads where id = '44444444-4444-4444-8444-444444444444'),
  '11111111-1111-1111-1111-111111111111',
  'lead stores tenant linkage'
);

select is(
  (select operator_id::text from public.leads where id = '44444444-4444-4444-8444-444444444444'),
  '22222222-2222-2222-2222-222222222222',
  'lead stores operator linkage'
);

select ok(
  (public.create_bid_from_lead('44444444-4444-4444-8444-444444444444', 'pressure_washing')->>'ok')::boolean,
  'lead converts into a bid'
);

select is(
  (select customer_id::text from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444')),
  '33333333-3333-4333-8333-333333333333',
  'bid keeps customer linkage'
);

select is(
  (select lead_id::text from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444')),
  '44444444-4444-4444-8444-444444444444',
  'bid keeps lead linkage'
);

update public.bids
   set status = 'approved',
       line_items = '[{"id":"sql-line-1","name":"House wash","description":"Soft wash siding","quantity":1,"unit":"job","kind":"base","unit_price_cents":35000}]'::jsonb,
       subtotal_cents = 35000,
       total_cents = 35000,
       deposit_amount_cents = 10000,
       updated_at = now()
 where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444');

select ok(
  (public.create_order_from_bid((select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444'))->>'ok')::boolean,
  'bid converts into an order'
);

select is(
  (select bid_id::text from public.orders where id = (select converted_order_id from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444'))),
  (select converted_bid_id::text from public.leads where id = '44444444-4444-4444-8444-444444444444'),
  'order keeps bid linkage'
);

select is(
  (select lead_id::text from public.orders where id = (select converted_order_id from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444'))),
  '44444444-4444-4444-8444-444444444444',
  'order keeps lead linkage'
);

select ok(
  (public.create_job_from_order((select converted_order_id from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444')))->>'ok')::boolean,
  'order converts into a job'
);

select is(
  (select order_id::text from public.jobs where id = (select primary_job_id from public.orders where id = (select converted_order_id from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444')))),
  (select converted_order_id::text from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444')),
  'job keeps order linkage'
);

select is(
  (select payment_state from public.orders where id = (select converted_order_id from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444'))),
  'unpaid',
  'new tracked order starts unpaid'
);

insert into public.payments (
  id,
  tenant_id,
  operator_id,
  customer_id,
  order_id,
  job_id,
  payment_mode,
  status,
  amount_subtotal,
  amount_total,
  currency,
  source,
  paid_at,
  metadata
) values (
  '55555555-5555-4555-8555-555555555551',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  (select converted_order_id from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444')),
  (select primary_job_id from public.orders where id = (select converted_order_id from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444'))),
  'cash',
  'paid',
  15000,
  15000,
  'usd',
  'manual',
  now(),
  '{"sequence":"partial"}'::jsonb
);

select is(
  (select payment_state from public.orders where id = (select converted_order_id from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444'))),
  'partially_paid',
  'partial payment updates order payment state'
);

select is(
  (select payment_state from public.jobs where id = (select primary_job_id from public.orders where id = (select converted_order_id from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444')))),
  'partially_paid',
  'partial payment updates job payment state'
);

insert into public.payments (
  id,
  tenant_id,
  operator_id,
  customer_id,
  order_id,
  job_id,
  payment_mode,
  status,
  amount_subtotal,
  amount_total,
  currency,
  source,
  paid_at,
  metadata
) values (
  '55555555-5555-4555-8555-555555555552',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  (select converted_order_id from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444')),
  (select primary_job_id from public.orders where id = (select converted_order_id from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444'))),
  'check',
  'paid',
  20000,
  20000,
  'usd',
  'manual',
  now(),
  '{"sequence":"final"}'::jsonb
);

select is(
  (select payment_state from public.orders where id = (select converted_order_id from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444'))),
  'paid',
  'full payment updates order payment state'
);

delete from public.payments
 where order_id = (select converted_order_id from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444'));

update public.orders
   set status = 'confirmed',
       payment_due_date = current_date - 1
 where id = (select converted_order_id from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444'));

select ok(
  (public.recompute_order_payment_state((select converted_order_id from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444')))->>'ok')::boolean,
  'payment state can be recomputed after payment changes'
);

select is(
  (select payment_state from public.orders where id = (select converted_order_id from public.bids where id = (select converted_bid_id from public.leads where id = '44444444-4444-4444-8444-444444444444'))),
  'overdue',
  'overdue payment state resolves correctly'
);

select * from finish();

rollback;
