-- Lock submit_storefront_order down to service-role callers.
-- The public storefront must go through the Netlify proxy so pricing and
-- fulfillment are recomputed server-side before the RPC executes.

revoke all on function public.submit_storefront_order(jsonb) from public;
revoke execute on function public.submit_storefront_order(jsonb) from anon;
revoke execute on function public.submit_storefront_order(jsonb) from authenticated;
grant execute on function public.submit_storefront_order(jsonb) to service_role;
