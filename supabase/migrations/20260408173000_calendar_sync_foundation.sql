create table if not exists public.operator_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  operator_id uuid not null references public.operators(id) on delete cascade,
  provider text not null default 'google_calendar',
  provider_user_id text null,
  provider_user_email text null,
  access_token text null,
  refresh_token text null,
  access_token_expires_at timestamptz null,
  selected_calendar_ids jsonb not null default '[]'::jsonb,
  export_calendar_id text null,
  export_bookings boolean not null default false,
  consolidate_calendars boolean not null default true,
  sync_mode text not null default 'read_only',
  sync_lock_until timestamptz null,
  last_synced_at timestamptz null,
  last_sync_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operator_calendar_connections_provider_check check (provider in ('google_calendar')),
  constraint operator_calendar_connections_sync_mode_check check (sync_mode in ('read_only', 'read_write'))
);

create unique index if not exists operator_calendar_connections_operator_provider_idx
  on public.operator_calendar_connections (operator_id, provider);

create index if not exists operator_calendar_connections_tenant_idx
  on public.operator_calendar_connections (tenant_id);

create table if not exists public.operator_calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  operator_id uuid not null references public.operators(id) on delete cascade,
  connection_id uuid not null references public.operator_calendar_connections(id) on delete cascade,
  booking_id uuid null references public.bookings(id) on delete cascade,
  external_calendar_id text not null,
  external_event_id text not null,
  sync_direction text not null default 'export',
  last_local_fingerprint text null,
  last_remote_updated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operator_calendar_event_links_direction_check check (sync_direction in ('export', 'import'))
);

create unique index if not exists operator_calendar_event_links_connection_event_idx
  on public.operator_calendar_event_links (connection_id, external_calendar_id, external_event_id);

create unique index if not exists operator_calendar_event_links_booking_calendar_idx
  on public.operator_calendar_event_links (connection_id, booking_id, external_calendar_id)
  where booking_id is not null;
