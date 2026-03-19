-- ProofLink staged tenant seed
-- Purpose: create a few disposable test tenants that exercise plan health, upgrade pressure, and admin visibility.
-- Cleanup: delete by slug in the cleanup block at the bottom.

begin;

insert into public.tenants (
  id,
  name,
  slug,
  owner_email,
  business_type,
  prooflink_plan_key,
  billing_status,
  status,
  billing_exempt,
  product_count,
  max_products,
  customer_count,
  max_customers,
  operator_seat_count,
  max_operator_seats,
  current_month_order_count,
  max_orders_per_month,
  storage_used_mb,
  max_storage_mb,
  allow_online_checkout,
  allow_custom_domain,
  allow_advanced_analytics,
  allow_automation,
  created_at
)
values
  (
    gen_random_uuid(),
    'Northwind Field Services',
    'northwind-field-services-stage',
    'northwind-stage@prooflink.local',
    'service_business',
    'starter',
    'active',
    'active',
    true,
    8,
    10,
    74,
    100,
    1,
    1,
    81,
    100,
    77,
    100,
    false,
    false,
    false,
    false,
    now()
  ),
  (
    gen_random_uuid(),
    'Harbor Bloom Events',
    'harbor-bloom-events-stage',
    'harbor-stage@prooflink.local',
    'events',
    'starter',
    'active',
    'active',
    true,
    10,
    10,
    98,
    100,
    1,
    1,
    100,
    100,
    94,
    100,
    false,
    false,
    false,
    false,
    now()
  ),
  (
    gen_random_uuid(),
    'Granite Peak Outfitters',
    'granite-peak-outfitters-stage',
    'granite-stage@prooflink.local',
    'other',
    'growth',
    'active',
    'active',
    true,
    42,
    100,
    415,
    1000,
    3,
    5,
    220,
    500,
    180,
    500,
    true,
    false,
    true,
    false,
    now()
  )
on conflict (slug) do update
set
  owner_email = excluded.owner_email,
  business_type = excluded.business_type,
  prooflink_plan_key = excluded.prooflink_plan_key,
  billing_status = excluded.billing_status,
  status = excluded.status,
  billing_exempt = excluded.billing_exempt,
  product_count = excluded.product_count,
  max_products = excluded.max_products,
  customer_count = excluded.customer_count,
  max_customers = excluded.max_customers,
  operator_seat_count = excluded.operator_seat_count,
  max_operator_seats = excluded.max_operator_seats,
  current_month_order_count = excluded.current_month_order_count,
  max_orders_per_month = excluded.max_orders_per_month,
  storage_used_mb = excluded.storage_used_mb,
  max_storage_mb = excluded.max_storage_mb,
  allow_online_checkout = excluded.allow_online_checkout,
  allow_custom_domain = excluded.allow_custom_domain,
  allow_advanced_analytics = excluded.allow_advanced_analytics,
  allow_automation = excluded.allow_automation;

commit;

-- cleanup when finished
-- delete from public.tenants
-- where slug in (
--   'northwind-field-services-stage',
--   'harbor-bloom-events-stage',
--   'granite-peak-outfitters-stage'
-- );
