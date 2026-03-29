-- ============================================================================
-- ProofLink — Authenticated-user RLS policies
-- Adds tenant-scoped read/write access for logged-in operators.
-- Safe to run multiple times — all policy creates are wrapped in exception
-- handlers so duplicate-object errors are silently skipped.
--
-- Run in Supabase SQL Editor (service role key required).
-- ============================================================================

-- ── Helper function: is the current auth user a member of this operator? ─────
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
    where om.user_id  = auth.uid()
      and om.operator_id = target_operator_id
  );
$$;

revoke all   on function public.operator_member_access(uuid) from public;
grant execute on function public.operator_member_access(uuid) to authenticated, service_role;

grant usage on schema public to authenticated;

-- ── Table grants ─────────────────────────────────────────────────────────────
grant select                          on public.tenants                to authenticated;
grant select                          on public.operator_members       to authenticated;
grant select                          on public.operators              to authenticated;
grant select, insert, update, delete  on public.orders                 to authenticated;
grant select, insert, update, delete  on public.customers              to authenticated;
grant select, insert, update, delete  on public.products               to authenticated;
grant select, insert, update, delete  on public.pricing                to authenticated;
grant select, insert, update, delete  on public.availability           to authenticated;
grant select, insert, update, delete  on public.expenses               to authenticated;
grant select, insert, update, delete  on public.payments               to authenticated;
grant select, insert, update, delete  on public.customer_interactions  to authenticated;
grant select, insert, update, delete  on public.services               to authenticated;
grant select, insert, update, delete  on public.quotes                 to authenticated;
grant select, insert, update, delete  on public.bookings               to authenticated;
grant select, insert, update, delete  on public.leads                  to authenticated;

-- ── Enable RLS on all tables ─────────────────────────────────────────────────
alter table public.tenants               enable row level security;
alter table public.operator_members      enable row level security;
alter table public.operators             enable row level security;
alter table public.orders                enable row level security;
alter table public.customers             enable row level security;
alter table public.products              enable row level security;
alter table public.pricing               enable row level security;
alter table public.availability          enable row level security;
alter table public.expenses              enable row level security;
alter table public.payments              enable row level security;
alter table public.customer_interactions enable row level security;
alter table public.services              enable row level security;
alter table public.quotes                enable row level security;
alter table public.bookings              enable row level security;
alter table public.leads                 enable row level security;

-- ── tenants: member can read their own tenant record ─────────────────────────
do $$ begin
  create policy "tenants_member_read"
    on public.tenants for select to authenticated
    using (
      exists (
        select 1 from public.operator_members om
        where om.user_id    = auth.uid()
          and om.tenant_id  = id
      )
    );
exception when duplicate_object then null; end $$;

-- ── operator_members: user can read their own membership rows ─────────────────
do $$ begin
  create policy "operator_members_self_read"
    on public.operator_members for select to authenticated
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- ── operators: member can read their operator record ─────────────────────────
do $$ begin
  create policy "operators_member_read"
    on public.operators for select to authenticated
    using (public.operator_member_access(id));
exception when duplicate_object then null; end $$;

-- ── orders: full CRUD scoped to the operator the user belongs to ──────────────
do $$ begin
  create policy "orders_operator_all"
    on public.orders for all to authenticated
    using     (public.operator_member_access(operator_id))
    with check(public.operator_member_access(operator_id));
exception when duplicate_object then null; end $$;

-- ── customers ─────────────────────────────────────────────────────────────────
do $$ begin
  create policy "customers_operator_all"
    on public.customers for all to authenticated
    using     (public.operator_member_access(operator_id))
    with check(public.operator_member_access(operator_id));
exception when duplicate_object then null; end $$;

-- ── products ──────────────────────────────────────────────────────────────────
do $$ begin
  create policy "products_operator_all"
    on public.products for all to authenticated
    using     (public.operator_member_access(operator_id))
    with check(public.operator_member_access(operator_id));
exception when duplicate_object then null; end $$;

-- ── pricing ───────────────────────────────────────────────────────────────────
do $$ begin
  create policy "pricing_operator_all"
    on public.pricing for all to authenticated
    using     (public.operator_member_access(operator_id))
    with check(public.operator_member_access(operator_id));
exception when duplicate_object then null; end $$;

-- ── availability ──────────────────────────────────────────────────────────────
do $$ begin
  create policy "availability_operator_all"
    on public.availability for all to authenticated
    using     (public.operator_member_access(operator_id))
    with check(public.operator_member_access(operator_id));
exception when duplicate_object then null; end $$;

-- ── expenses ──────────────────────────────────────────────────────────────────
do $$ begin
  create policy "expenses_operator_all"
    on public.expenses for all to authenticated
    using     (public.operator_member_access(operator_id))
    with check(public.operator_member_access(operator_id));
exception when duplicate_object then null; end $$;

-- ── payments ──────────────────────────────────────────────────────────────────
do $$ begin
  create policy "payments_operator_all"
    on public.payments for all to authenticated
    using     (public.operator_member_access(operator_id))
    with check(public.operator_member_access(operator_id));
exception when duplicate_object then null; end $$;

-- ── customer_interactions ─────────────────────────────────────────────────────
do $$ begin
  create policy "customer_interactions_operator_all"
    on public.customer_interactions for all to authenticated
    using     (public.operator_member_access(operator_id))
    with check(public.operator_member_access(operator_id));
exception when duplicate_object then null; end $$;

-- ── services ──────────────────────────────────────────────────────────────────
do $$ begin
  create policy "services_operator_all"
    on public.services for all to authenticated
    using     (public.operator_member_access(operator_id))
    with check(public.operator_member_access(operator_id));
exception when duplicate_object then null; end $$;

-- ── quotes ────────────────────────────────────────────────────────────────────
do $$ begin
  create policy "quotes_operator_all"
    on public.quotes for all to authenticated
    using     (public.operator_member_access(operator_id))
    with check(public.operator_member_access(operator_id));
exception when duplicate_object then null; end $$;

-- ── bookings ──────────────────────────────────────────────────────────────────
do $$ begin
  create policy "bookings_operator_all"
    on public.bookings for all to authenticated
    using     (public.operator_member_access(operator_id))
    with check(public.operator_member_access(operator_id));
exception when duplicate_object then null; end $$;

-- ── leads ─────────────────────────────────────────────────────────────────────
do $$ begin
  create policy "leads_operator_all"
    on public.leads for all to authenticated
    using     (public.operator_member_access(operator_id))
    with check(public.operator_member_access(operator_id));
exception when duplicate_object then null; end $$;

-- ── Verify ───────────────────────────────────────────────────────────────────
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and roles @> array['authenticated']
order by tablename, policyname;
