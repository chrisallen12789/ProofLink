begin;

insert into public.tenants (
  id,
  name,
  slug,
  owner_email,
  prooflink_plan_key,
  billing_status,
  billing_exempt,
  product_count,
  customer_count,
  operator_seat_count,
  current_month_order_count,
  storage_used_mb
)
values (
  gen_random_uuid(),
  'Northwind Field Services',
  'northwind-field-services-stage',
  'stage-northwind@test.prooflink.co',
  'starter',
  'active',
  true,
  8,
  80,
  1,
  80,
  75
),
(
  gen_random_uuid(),
  'Harbor Bloom Events',
  'harbor-bloom-events-stage',
  'stage-harbor@test.prooflink.co',
  'starter',
  'active',
  true,
  10,
  100,
  1,
  100,
  100
),
(
  gen_random_uuid(),
  'Granite Peak Outfitters',
  'granite-peak-outfitters-stage',
  'stage-granite@test.prooflink.co',
  'starter',
  'active',
  true,
  2,
  15,
  1,
  10,
  12
);

commit;

-- cleanup when finished
-- delete from public.tenants
-- where slug in (
--   'northwind-field-services-stage',
--   'harbor-bloom-events-stage',
--   'granite-peak-outfitters-stage'
-- );
