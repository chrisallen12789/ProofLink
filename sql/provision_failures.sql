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
  created_at timestamptz not null default now()
);

create index if not exists idx_provision_failures_request
  on public.provision_failures (onboarding_request_id, created_at desc);

create index if not exists idx_provision_failures_tenant
  on public.provision_failures (tenant_id, created_at desc);
