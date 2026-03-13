-- ProofLink tenant-scoped operator RLS hardening
-- Run in the DEV Supabase project after operator bootstrap is already working.

begin;

create or replace function public.operator_member_access(target_operator_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.operator_members om
    where om.user_id = auth.uid()
      and om.operator_id = target_operator_id
  );
$$;

revoke all on function public.operator_member_access(uuid) from public;
grant execute on function public.operator_member_access(uuid) to authenticated, service_role;

grant usage on schema public to authenticated;

grant select on public.operator_members to authenticated;
grant select on public.operators to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.pricing to authenticated;
grant select, insert, update, delete on public.availability to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.payments to authenticated;
grant select, insert, update, delete on public.customer_interactions to authenticated;

alter table public.operator_members enable row level security;
alter table public.operators enable row level security;
alter table public.products enable row level security;
alter table public.pricing enable row level security;
alter table public.availability enable row level security;
alter table public.expenses enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.payments enable row level security;
alter table public.customer_interactions enable row level security;

-- Remove broad dev-era permissive policies if they exist.
drop policy if exists operator_members_select on public.operator_members;
drop policy if exists operator_members_read on public.operator_members;
drop policy if exists operator_members_dev_self_read on public.operator_members;
drop policy if exists operators_select on public.operators;
drop policy if exists operators_read on public.operators;
drop policy if exists operators_dev_auth_all on public.operators;
drop policy if exists products_select on public.products;
drop policy if exists pricing_select on public.pricing;
drop policy if exists availability_select on public.availability;
drop policy if exists expenses_select on public.expenses;
drop policy if exists customers_select on public.customers;
drop policy if exists customers_authenticated_read on public.customers;
drop policy if exists orders_select on public.orders;
drop policy if exists orders_authenticated_read on public.orders;
drop policy if exists payments_select on public.payments;
drop policy if exists customer_interactions_select on public.customer_interactions;

-- Membership and operator resolution.
create policy operator_members_self_read
on public.operator_members
for select
to authenticated
using (user_id = auth.uid());

create policy operators_member_read
on public.operators
for select
to authenticated
using (public.operator_member_access(id));

-- Tenant-scoped operator CRUD for app-owned tables.
create policy products_operator_all
on public.products
for all
to authenticated
using (public.operator_member_access(operator_id))
with check (public.operator_member_access(operator_id));

create policy pricing_operator_all
on public.pricing
for all
to authenticated
using (public.operator_member_access(operator_id))
with check (public.operator_member_access(operator_id));

create policy availability_operator_all
on public.availability
for all
to authenticated
using (public.operator_member_access(operator_id))
with check (public.operator_member_access(operator_id));

create policy expenses_operator_all
on public.expenses
for all
to authenticated
using (public.operator_member_access(operator_id))
with check (public.operator_member_access(operator_id));

create policy customers_operator_all
on public.customers
for all
to authenticated
using (public.operator_member_access(operator_id))
with check (public.operator_member_access(operator_id));

create policy orders_operator_all
on public.orders
for all
to authenticated
using (public.operator_member_access(operator_id))
with check (public.operator_member_access(operator_id));

create policy payments_operator_all
on public.payments
for all
to authenticated
using (public.operator_member_access(operator_id))
with check (public.operator_member_access(operator_id));

create policy customer_interactions_operator_all
on public.customer_interactions
for all
to authenticated
using (public.operator_member_access(operator_id))
with check (public.operator_member_access(operator_id));

commit;
