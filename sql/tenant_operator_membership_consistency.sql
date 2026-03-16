-- ProofLink
-- Enforce operator_id + tenant_id consistency for tenant-scoped tables.
-- Apply to existing projects after the core schema is in place.

create or replace function public.operator_member_tenant_access(target_operator_id uuid, target_tenant_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_operator_id is not null
    and nullif(btrim(coalesce(target_tenant_id, '')), '') is not null
    and exists (
      select 1
      from public.operator_members om
      where om.user_id = auth.uid()
        and om.operator_id = target_operator_id
        and om.tenant_id::text = btrim(target_tenant_id)
    );
$$;

revoke all on function public.operator_member_tenant_access(uuid, text) from public;
grant execute on function public.operator_member_tenant_access(uuid, text) to authenticated, service_role;

create or replace function public.enforce_operator_tenant_membership_pair()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.operator_id is null or nullif(btrim(coalesce(new.tenant_id, '')), '') is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.operator_members om
    where om.operator_id = new.operator_id
      and om.tenant_id::text = btrim(new.tenant_id)
  ) then
    raise exception using
      errcode = '23503',
      message = format(
        'operator_id %s is not a member of tenant_id %s',
        new.operator_id,
        new.tenant_id
      ),
      detail = format(
        '%s requires a valid operator_members(operator_id, tenant_id) pair',
        tg_table_name
      );
  end if;

  return new;
end;
$$;

drop trigger if exists products_operator_tenant_pair_guard on public.products;
create trigger products_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.products
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists pricing_operator_tenant_pair_guard on public.pricing;
create trigger pricing_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.pricing
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists availability_operator_tenant_pair_guard on public.availability;
create trigger availability_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.availability
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists expenses_operator_tenant_pair_guard on public.expenses;
create trigger expenses_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.expenses
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists customers_operator_tenant_pair_guard on public.customers;
create trigger customers_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.customers
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists orders_operator_tenant_pair_guard on public.orders;
create trigger orders_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.orders
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists payments_operator_tenant_pair_guard on public.payments;
create trigger payments_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.payments
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

drop trigger if exists customer_interactions_operator_tenant_pair_guard on public.customer_interactions;
create trigger customer_interactions_operator_tenant_pair_guard
  before insert or update of operator_id, tenant_id
  on public.customer_interactions
  for each row
  execute function public.enforce_operator_tenant_membership_pair();

do $$ begin
  drop policy if exists products_operator_all on public.products;
  create policy products_operator_all on public.products for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists pricing_operator_all on public.pricing;
  create policy pricing_operator_all on public.pricing for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists availability_operator_all on public.availability;
  create policy availability_operator_all on public.availability for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists expenses_operator_all on public.expenses;
  create policy expenses_operator_all on public.expenses for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists customers_operator_all on public.customers;
  create policy customers_operator_all on public.customers for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists orders_operator_all on public.orders;
  create policy orders_operator_all on public.orders for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists payments_operator_all on public.payments;
  create policy payments_operator_all on public.payments for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists customer_interactions_operator_all on public.customer_interactions;
  create policy customer_interactions_operator_all on public.customer_interactions for all to authenticated
    using (public.operator_member_tenant_access(operator_id, tenant_id))
    with check (public.operator_member_tenant_access(operator_id, tenant_id));
exception when others then null;
end $$;
