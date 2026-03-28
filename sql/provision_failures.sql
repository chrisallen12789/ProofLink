create table if not exists public.provision_failures (
  id uuid primary key default gen_random_uuid(),
  onboarding_request_id uuid references public.tenant_onboarding_requests(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  operator_id uuid references public.operators(id) on delete set null,
  owner_email text,
  failure_stage text not null,
  failure_message text not null,
  rollback_issues jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint provision_failures_stage_check
    check (failure_stage in ('rollback', 'auth', 'tenant', 'operator', 'config', 'stripe', 'email'))
);

alter table public.provision_failures enable row level security;

do $$ begin
  create policy "Service role full access on provision_failures"
    on public.provision_failures for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

create index if not exists idx_provision_failures_request
  on public.provision_failures (onboarding_request_id, created_at desc)
  where onboarding_request_id is not null;

create index if not exists idx_provision_failures_tenant
  on public.provision_failures (tenant_id, created_at desc)
  where tenant_id is not null;

grant select, insert, update, delete on table public.provision_failures to service_role;
revoke all on table public.provision_failures from anon;
revoke all on table public.provision_failures from authenticated;
