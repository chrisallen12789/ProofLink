-- ============================================================================
-- ProofLink Governance System v1 — Database Migration
-- Run this in Supabase SQL Editor (or via supabase db push)
-- Safe to run on an existing database. All changes are additive.
-- ============================================================================

-- ── 1. onboarding_requests — add governance columns ──────────────────────────
-- These are all additive. Existing rows get NULL values, which is fine.

alter table onboarding_requests
  add column if not exists risk_level        text check (risk_level in ('low','medium','high')),
  add column if not exists reason_codes      text[],          -- machine-readable codes e.g. DISPOSABLE_EMAIL
  add column if not exists evaluation_result jsonb,           -- full rule engine output for audit
  add column if not exists evaluated_at      timestamptz,
  add column if not exists admin_notes       text,            -- internal admin notes, never shown to applicant
  add column if not exists compliance_notes  text,            -- compliance-specific notes
  add column if not exists manual_override   boolean default false,
  add column if not exists reviewed_by       uuid references auth.users(id),
  add column if not exists reviewed_at       timestamptz;

-- Update status check constraint to include new lifecycle values.
-- Drop the old constraint first, then recreate it.
-- NOTE: If no check constraint exists, the alter column is sufficient.
do $$ begin
  alter table onboarding_requests
    drop constraint if exists onboarding_requests_status_check;
exception when others then null;
end $$;

alter table onboarding_requests
  add constraint onboarding_requests_status_check
  check (status in (
    'pending_verification',  -- submitted, email not yet verified
    'needs_review',          -- rule engine flagged for human review
    'approved',              -- approved (pending provisioning or auto-provisioned)
    'rejected',              -- rejected by rules or admin
    -- Legacy values — keep for backward compat with existing rows
    'submitted',
    'provisioning',
    'provisioned',
    'failed'
  ));

-- ── 2. tenants — add lifecycle status + conduct columns ──────────────────────
alter table tenants
  add column if not exists status            text default 'active',
  add column if not exists conduct_action    text,            -- last conduct action: flag/suspend/reinstate/terminate
  add column if not exists conduct_reason    text,            -- reason code for last conduct action
  add column if not exists conduct_notes     text,            -- admin notes for last action
  add column if not exists conduct_updated_at timestamptz,
  add column if not exists conduct_updated_by uuid references auth.users(id),
  add column if not exists flagged_at        timestamptz,
  add column if not exists suspended_at      timestamptz,
  add column if not exists terminated_at     timestamptz;

-- Migrate existing boolean active field to status field for any rows that
-- already have data. active=true → 'active', active=false → 'inactive'.
-- Only updates rows where status is still NULL (i.e. newly added column).
update tenants
  set status = case when active = false then 'inactive' else 'active' end
  where status is null;

do $$ begin
  alter table tenants
    drop constraint if exists tenants_status_check;
exception when others then null;
end $$;

alter table tenants
  add constraint tenants_status_check
  check (status in ('provisioning','active','flagged','suspended','terminated','inactive'));

-- ── 3. Rule tables — for admin-managed governance config ─────────────────────

-- Reserved slugs (extends the hardcoded baseline in evaluate-onboarding.js)
create table if not exists pl_reserved_slugs (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  reason     text,                    -- why it's reserved
  active     boolean not null default true,
  created_at timestamptz default now()
);

-- Seed with a minimal set. The function baseline covers the rest.
insert into pl_reserved_slugs (slug, reason) values
  ('shop',    'generic — too ambiguous'),
  ('store',   'generic — too ambiguous'),
  ('checkout','platform reserved'),
  ('payment', 'platform reserved'),
  ('health',  'platform reserved')
on conflict (slug) do nothing;

-- Banned keywords (profanity, policy violations — extends baseline)
create table if not exists pl_banned_keywords (
  id         uuid primary key default gen_random_uuid(),
  keyword    text not null,
  category   text not null,           -- profanity | impersonation | suspicious | restricted
  verdict    text not null default 'REJECT' check (verdict in ('REJECT','FLAG')),
  active     boolean not null default true,
  notes      text,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

create index if not exists pl_banned_keywords_active_idx on pl_banned_keywords(active);

-- Protected brands (business name cannot contain these)
create table if not exists pl_protected_brands (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  notes      text,
  created_at timestamptz default now()
);

-- Seed a few brands not in the hardcoded baseline (admin can add more)
insert into pl_protected_brands (name, notes) values
  ('ebay',        'brand protection'),
  ('etsy',        'brand protection'),
  ('square',      'brand protection'),
  ('quickbooks',  'brand protection'),
  ('woocommerce', 'brand protection')
on conflict (name) do nothing;

-- Prohibited categories (admin can adjust keyword lists without code changes)
-- Verdict: REJECT = auto-reject, FLAG = needs_review
create table if not exists pl_prohibited_categories (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique,       -- e.g. 'cannabis', 'firearms'
  keywords text[] not null,
  verdict  text not null default 'REJECT' check (verdict in ('REJECT','FLAG')),
  notes    text,
  active   boolean not null default true,
  created_at timestamptz default now()
);

-- Seed the cannabis restricted category so it can be managed via admin
insert into pl_prohibited_categories (name, keywords, verdict, notes) values
  ('cannabis', ARRAY['cannabis','dispensary','marijuana','cbd store','thc products',
                     'weed shop','pot shop','420 store','hemp flower','dispo',
                     'recreational cannabis','medical marijuana'],
   'FLAG', 'Restricted — manual review required. May be unlocked for Michigan operators in a future dispensary edition.')
on conflict (name) do nothing;

-- ── 4. Tenant conduct log ─────────────────────────────────────────────────────
-- Immutable audit trail of all conduct actions. Never update, only insert.

create table if not exists tenant_conduct_log (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  action       text not null check (action in ('flag','suspend','reinstate','terminate')),
  reason_code  text,
  admin_notes  text,
  performed_by uuid references auth.users(id),
  performed_at timestamptz not null default now()
);

create index if not exists tenant_conduct_log_tenant_idx on tenant_conduct_log(tenant_id);
create index if not exists tenant_conduct_log_at_idx     on tenant_conduct_log(performed_at desc);

-- ── 5. Row Level Security ─────────────────────────────────────────────────────
-- Rule tables: readable by authenticated admins, writable by service role only.
-- Conduct log: readable by admins, append-only from service role.

alter table pl_reserved_slugs       enable row level security;
alter table pl_banned_keywords      enable row level security;
alter table pl_protected_brands     enable row level security;
alter table pl_prohibited_categories enable row level security;
alter table tenant_conduct_log      enable row level security;

-- Admin read policy (assuming profiles.role = 'admin')
do $$ begin
  create policy "Admins can read pl_reserved_slugs"
    on pl_reserved_slugs for select
    using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Admins can read pl_banned_keywords"
    on pl_banned_keywords for select
    using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Admins can read pl_protected_brands"
    on pl_protected_brands for select
    using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Admins can read pl_prohibited_categories"
    on pl_prohibited_categories for select
    using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Admins can read tenant_conduct_log"
    on tenant_conduct_log for select
    using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
exception when duplicate_object then null;
end $$;

-- ── 6. Useful indexes ─────────────────────────────────────────────────────────
create index if not exists onboarding_requests_status_idx    on onboarding_requests(status);
create index if not exists onboarding_requests_email_idx     on onboarding_requests(owner_email);
create index if not exists onboarding_requests_risk_idx      on onboarding_requests(risk_level);
create index if not exists tenants_status_idx                on tenants(status);
create index if not exists tenants_conduct_updated_idx       on tenants(conduct_updated_at desc nulls last);

-- ── Done ──────────────────────────────────────────────────────────────────────
-- Summary of what was created / altered:
--
-- ALTERED  onboarding_requests — added: risk_level, reason_codes, evaluation_result,
--                                        evaluated_at, admin_notes, compliance_notes,
--                                        manual_override, reviewed_by, reviewed_at
--                                updated: status check constraint (new values)
--
-- ALTERED  tenants             — added: status, conduct_action, conduct_reason,
--                                        conduct_notes, conduct_updated_at/by,
--                                        flagged_at, suspended_at, terminated_at
--                                updated: status check constraint (new values)
--
-- CREATED  pl_reserved_slugs        — admin-managed reserved slug list
-- CREATED  pl_banned_keywords       — admin-managed banned keyword list
-- CREATED  pl_protected_brands      — admin-managed brand protection list
-- CREATED  pl_prohibited_categories — admin-managed category rules
-- CREATED  tenant_conduct_log       — immutable audit trail of conduct actions
