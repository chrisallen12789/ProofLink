-- ============================================================================
-- ProofLink Proposal Document Engine
-- Run after sql/service_workflow_phase1.sql
-- Adds reusable, versioned customer-facing proposal documents layered onto bids.
-- ============================================================================

create or replace function public.user_belongs_to_tenant(target_tenant_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    nullif(btrim(coalesce(target_tenant_id, '')), '') is not null
    and exists (
      select 1
      from public.operator_members om
      where om.user_id = auth.uid()
        and om.tenant_id::text = btrim(target_tenant_id)
    );
$$;

revoke all on function public.user_belongs_to_tenant(text) from public;
grant execute on function public.user_belongs_to_tenant(text) to authenticated, service_role;

create table if not exists public.document_templates (
  id                 uuid        primary key default gen_random_uuid(),
  tenant_id          text,
  created_by_user_id uuid,
  template_key       text        not null,
  family             text        not null,
  name               text        not null,
  description        text,
  active             boolean     not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint document_templates_family_check
    check (family in ('standard_operational', 'formal_vendor'))
);

create unique index if not exists uq_document_templates_system_key
  on public.document_templates (template_key)
  where tenant_id is null;
create unique index if not exists uq_document_templates_tenant_key
  on public.document_templates (tenant_id, template_key)
  where tenant_id is not null;
create index if not exists idx_document_templates_tenant_family
  on public.document_templates (tenant_id, family, active, updated_at desc);

create table if not exists public.document_template_versions (
  id                 uuid        primary key default gen_random_uuid(),
  template_id        uuid        not null references public.document_templates(id) on delete cascade,
  version_number     integer     not null,
  layout_key         text        not null,
  editable_regions   jsonb       not null default '[]'::jsonb,
  defaults           jsonb       not null default '{}'::jsonb,
  status             text        not null default 'published',
  created_by_user_id uuid,
  created_at         timestamptz not null default now(),
  constraint document_template_versions_status_check
    check (status in ('draft', 'published', 'archived'))
);

create unique index if not exists uq_document_template_versions_template_version
  on public.document_template_versions (template_id, version_number);
create index if not exists idx_document_template_versions_template_status
  on public.document_template_versions (template_id, status, version_number desc);

create table if not exists public.reusable_terms_templates (
  id                 uuid        primary key default gen_random_uuid(),
  tenant_id          text,
  created_by_user_id uuid,
  template_key       text        not null,
  service_type       text,
  name               text        not null,
  body_text          text        not null,
  active             boolean     not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists uq_terms_templates_system_key
  on public.reusable_terms_templates (template_key)
  where tenant_id is null;
create unique index if not exists uq_terms_templates_tenant_key
  on public.reusable_terms_templates (tenant_id, template_key)
  where tenant_id is not null;
create index if not exists idx_terms_templates_lookup
  on public.reusable_terms_templates (tenant_id, service_type, active, updated_at desc);

create table if not exists public.reusable_exclusions_templates (
  id                 uuid        primary key default gen_random_uuid(),
  tenant_id          text,
  created_by_user_id uuid,
  template_key       text        not null,
  service_type       text,
  name               text        not null,
  body_text          text        not null,
  active             boolean     not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists uq_exclusions_templates_system_key
  on public.reusable_exclusions_templates (template_key)
  where tenant_id is null;
create unique index if not exists uq_exclusions_templates_tenant_key
  on public.reusable_exclusions_templates (tenant_id, template_key)
  where tenant_id is not null;
create index if not exists idx_exclusions_templates_lookup
  on public.reusable_exclusions_templates (tenant_id, service_type, active, updated_at desc);

create table if not exists public.tenant_branding_profiles (
  id                             uuid        primary key default gen_random_uuid(),
  tenant_id                      text        not null unique,
  company_name                   text,
  logo_image_url                 text,
  primary_color                  text,
  address_text                   text,
  phone                          text,
  email                          text,
  website                        text,
  default_terms_template_id      uuid        references public.reusable_terms_templates(id) on delete set null,
  default_exclusions_template_id uuid        references public.reusable_exclusions_templates(id) on delete set null,
  default_sender_user_id         uuid,
  created_by_user_id             uuid,
  updated_by_user_id             uuid,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);

create index if not exists idx_tenant_branding_profiles_default_sender
  on public.tenant_branding_profiles (tenant_id, default_sender_user_id);

create table if not exists public.user_document_profiles (
  id                  uuid        primary key default gen_random_uuid(),
  tenant_id           text        not null,
  user_id             uuid        not null,
  full_name           text,
  job_title           text,
  phone               text,
  email               text,
  signature_image_url text,
  initials            text,
  is_default_signer   boolean     not null default false,
  active              boolean     not null default true,
  created_by_user_id  uuid,
  updated_by_user_id  uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists uq_user_document_profiles_tenant_user
  on public.user_document_profiles (tenant_id, user_id);
create unique index if not exists uq_user_document_profiles_default_signer
  on public.user_document_profiles (tenant_id)
  where is_default_signer = true;
create index if not exists idx_user_document_profiles_lookup
  on public.user_document_profiles (tenant_id, active, updated_at desc);

create table if not exists public.proposal_documents (
  id                     uuid        primary key default gen_random_uuid(),
  tenant_id              text        not null,
  bid_id                 uuid        references public.bids(id) on delete set null,
  customer_id            uuid        references public.customers(id) on delete set null,
  job_id                 uuid        references public.jobs(id) on delete set null,
  created_by_user_id     uuid,
  prepared_by_user_id    uuid,
  sender_user_id         uuid,
  template_id            uuid        references public.document_templates(id) on delete set null,
  template_version_id    uuid        references public.document_template_versions(id) on delete set null,
  template_type          text        not null default 'standard_operational',
  service_type           text,
  proposal_date          date        not null default current_date,
  expiration_date        date,
  recipient_name         text,
  recipient_company      text,
  recipient_address      text,
  attention_line         text,
  subject_line           text,
  project_name           text,
  site_address           text,
  intro_text             text,
  value_proposition_text text,
  notes_text             text,
  terms_template_id      uuid        references public.reusable_terms_templates(id) on delete set null,
  exclusions_template_id uuid        references public.reusable_exclusions_templates(id) on delete set null,
  terms_override         text,
  exclusions_override    text,
  status                 text        not null default 'draft',
  revision_number        integer     not null default 1,
  public_token           uuid        not null default gen_random_uuid(),
  render_state           jsonb       not null default '{}'::jsonb,
  rendered_html_snapshot text,
  pdf_asset_reference    text,
  sent_at                timestamptz,
  viewed_at              timestamptz,
  accepted_at            timestamptz,
  rejected_at            timestamptz,
  superseded_at          timestamptz,
  archived_at            timestamptz,
  accepted_version_id    uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint proposal_documents_template_type_check
    check (template_type in ('standard_operational', 'formal_vendor')),
  constraint proposal_documents_status_check
    check (status in ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'superseded', 'archived'))
);

create unique index if not exists uq_proposal_documents_public_token
  on public.proposal_documents (public_token);
create unique index if not exists uq_proposal_documents_bid
  on public.proposal_documents (bid_id)
  where bid_id is not null;
create index if not exists idx_proposal_documents_tenant_status
  on public.proposal_documents (tenant_id, status, updated_at desc);
create index if not exists idx_proposal_documents_customer
  on public.proposal_documents (tenant_id, customer_id, updated_at desc);
create index if not exists idx_proposal_documents_job
  on public.proposal_documents (tenant_id, job_id, updated_at desc);
create index if not exists idx_proposal_documents_sender
  on public.proposal_documents (tenant_id, sender_user_id, updated_at desc);

create table if not exists public.proposal_document_versions (
  id                   uuid        primary key default gen_random_uuid(),
  proposal_document_id uuid        not null references public.proposal_documents(id) on delete cascade,
  tenant_id            text        not null,
  revision_number      integer     not null,
  created_by_user_id   uuid,
  trigger_event        text        not null default 'manual_save',
  status               text        not null,
  template_version_id  uuid        references public.document_template_versions(id) on delete set null,
  render_state         jsonb       not null default '{}'::jsonb,
  rendered_html_snapshot text,
  branding_snapshot    jsonb       not null default '{}'::jsonb,
  sender_snapshot      jsonb       not null default '{}'::jsonb,
  options_snapshot     jsonb       not null default '[]'::jsonb,
  created_at           timestamptz not null default now(),
  constraint proposal_document_versions_status_check
    check (status in ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'superseded', 'archived'))
);

create unique index if not exists uq_proposal_document_versions_revision
  on public.proposal_document_versions (proposal_document_id, revision_number);
create index if not exists idx_proposal_document_versions_tenant
  on public.proposal_document_versions (tenant_id, proposal_document_id, created_at desc);

create table if not exists public.proposal_options (
  id                   uuid        primary key default gen_random_uuid(),
  proposal_document_id uuid        not null references public.proposal_documents(id) on delete cascade,
  tenant_id            text        not null,
  sort_order           integer     not null default 0,
  option_type          text        not null default 'option',
  option_title         text        not null,
  pricing_label        text,
  price_amount_cents   integer     not null default 0,
  price_unit           text,
  scope_content        jsonb       not null default '[]'::jsonb,
  fee_rows             jsonb       not null default '[]'::jsonb,
  notes                text,
  metadata             jsonb       not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint proposal_options_type_check
    check (option_type in ('option', 'alternate', 'add_on'))
);

create index if not exists idx_proposal_options_document
  on public.proposal_options (proposal_document_id, sort_order, created_at asc);
create index if not exists idx_proposal_options_tenant
  on public.proposal_options (tenant_id, proposal_document_id, sort_order);

do $$ begin
  alter table public.proposal_documents
    add constraint proposal_documents_accepted_version_id_fkey
    foreign key (accepted_version_id) references public.proposal_document_versions(id) on delete set null;
exception when duplicate_object then null;
end $$;

drop trigger if exists document_templates_updated_at_trigger on public.document_templates;
create trigger document_templates_updated_at_trigger
  before update on public.document_templates
  for each row execute function public.set_updated_at();

drop trigger if exists reusable_terms_templates_updated_at_trigger on public.reusable_terms_templates;
create trigger reusable_terms_templates_updated_at_trigger
  before update on public.reusable_terms_templates
  for each row execute function public.set_updated_at();

drop trigger if exists reusable_exclusions_templates_updated_at_trigger on public.reusable_exclusions_templates;
create trigger reusable_exclusions_templates_updated_at_trigger
  before update on public.reusable_exclusions_templates
  for each row execute function public.set_updated_at();

drop trigger if exists tenant_branding_profiles_updated_at_trigger on public.tenant_branding_profiles;
create trigger tenant_branding_profiles_updated_at_trigger
  before update on public.tenant_branding_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists user_document_profiles_updated_at_trigger on public.user_document_profiles;
create trigger user_document_profiles_updated_at_trigger
  before update on public.user_document_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists proposal_documents_updated_at_trigger on public.proposal_documents;
create trigger proposal_documents_updated_at_trigger
  before update on public.proposal_documents
  for each row execute function public.set_updated_at();

drop trigger if exists proposal_options_updated_at_trigger on public.proposal_options;
create trigger proposal_options_updated_at_trigger
  before update on public.proposal_options
  for each row execute function public.set_updated_at();

alter table public.document_templates enable row level security;
alter table public.document_template_versions enable row level security;
alter table public.reusable_terms_templates enable row level security;
alter table public.reusable_exclusions_templates enable row level security;
alter table public.tenant_branding_profiles enable row level security;
alter table public.user_document_profiles enable row level security;
alter table public.proposal_documents enable row level security;
alter table public.proposal_document_versions enable row level security;
alter table public.proposal_options enable row level security;

do $$ begin
  create policy "Service role full access on document_templates"
    on public.document_templates for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on document_template_versions"
    on public.document_template_versions for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on reusable_terms_templates"
    on public.reusable_terms_templates for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on reusable_exclusions_templates"
    on public.reusable_exclusions_templates for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on tenant_branding_profiles"
    on public.tenant_branding_profiles for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on user_document_profiles"
    on public.user_document_profiles for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on proposal_documents"
    on public.proposal_documents for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on proposal_document_versions"
    on public.proposal_document_versions for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Service role full access on proposal_options"
    on public.proposal_options for all to service_role
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  drop policy if exists document_templates_tenant_read on public.document_templates;
  create policy document_templates_tenant_read on public.document_templates for select to authenticated
    using (
      tenant_id is null
      or public.user_belongs_to_tenant(tenant_id)
    );
exception when others then null;
end $$;

do $$ begin
  drop policy if exists document_templates_tenant_write on public.document_templates;
  create policy document_templates_tenant_write on public.document_templates for all to authenticated
    using (tenant_id is not null and public.user_belongs_to_tenant(tenant_id))
    with check (tenant_id is not null and public.user_belongs_to_tenant(tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists document_template_versions_tenant_read on public.document_template_versions;
  create policy document_template_versions_tenant_read on public.document_template_versions for select to authenticated
    using (
      exists (
        select 1
        from public.document_templates dt
        where dt.id = template_id
          and (dt.tenant_id is null or public.user_belongs_to_tenant(dt.tenant_id))
      )
    );
exception when others then null;
end $$;

do $$ begin
  drop policy if exists document_template_versions_tenant_write on public.document_template_versions;
  create policy document_template_versions_tenant_write on public.document_template_versions for all to authenticated
    using (
      exists (
        select 1
        from public.document_templates dt
        where dt.id = template_id
          and dt.tenant_id is not null
          and public.user_belongs_to_tenant(dt.tenant_id)
      )
    )
    with check (
      exists (
        select 1
        from public.document_templates dt
        where dt.id = template_id
          and dt.tenant_id is not null
          and public.user_belongs_to_tenant(dt.tenant_id)
      )
    );
exception when others then null;
end $$;

do $$ begin
  drop policy if exists reusable_terms_templates_tenant_read on public.reusable_terms_templates;
  create policy reusable_terms_templates_tenant_read on public.reusable_terms_templates for select to authenticated
    using (
      tenant_id is null
      or public.user_belongs_to_tenant(tenant_id)
    );
exception when others then null;
end $$;

do $$ begin
  drop policy if exists reusable_terms_templates_tenant_write on public.reusable_terms_templates;
  create policy reusable_terms_templates_tenant_write on public.reusable_terms_templates for all to authenticated
    using (tenant_id is not null and public.user_belongs_to_tenant(tenant_id))
    with check (tenant_id is not null and public.user_belongs_to_tenant(tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists reusable_exclusions_templates_tenant_read on public.reusable_exclusions_templates;
  create policy reusable_exclusions_templates_tenant_read on public.reusable_exclusions_templates for select to authenticated
    using (
      tenant_id is null
      or public.user_belongs_to_tenant(tenant_id)
    );
exception when others then null;
end $$;

do $$ begin
  drop policy if exists reusable_exclusions_templates_tenant_write on public.reusable_exclusions_templates;
  create policy reusable_exclusions_templates_tenant_write on public.reusable_exclusions_templates for all to authenticated
    using (tenant_id is not null and public.user_belongs_to_tenant(tenant_id))
    with check (tenant_id is not null and public.user_belongs_to_tenant(tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists tenant_branding_profiles_tenant_all on public.tenant_branding_profiles;
  create policy tenant_branding_profiles_tenant_all on public.tenant_branding_profiles for all to authenticated
    using (public.user_belongs_to_tenant(tenant_id))
    with check (public.user_belongs_to_tenant(tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists user_document_profiles_tenant_all on public.user_document_profiles;
  create policy user_document_profiles_tenant_all on public.user_document_profiles for all to authenticated
    using (public.user_belongs_to_tenant(tenant_id))
    with check (public.user_belongs_to_tenant(tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists proposal_documents_tenant_all on public.proposal_documents;
  create policy proposal_documents_tenant_all on public.proposal_documents for all to authenticated
    using (public.user_belongs_to_tenant(tenant_id))
    with check (public.user_belongs_to_tenant(tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists proposal_document_versions_tenant_all on public.proposal_document_versions;
  create policy proposal_document_versions_tenant_all on public.proposal_document_versions for all to authenticated
    using (public.user_belongs_to_tenant(tenant_id))
    with check (public.user_belongs_to_tenant(tenant_id));
exception when others then null;
end $$;

do $$ begin
  drop policy if exists proposal_options_tenant_all on public.proposal_options;
  create policy proposal_options_tenant_all on public.proposal_options for all to authenticated
    using (public.user_belongs_to_tenant(tenant_id))
    with check (public.user_belongs_to_tenant(tenant_id));
exception when others then null;
end $$;

revoke all on table public.document_templates from anon;
revoke all on table public.document_template_versions from anon;
revoke all on table public.reusable_terms_templates from anon;
revoke all on table public.reusable_exclusions_templates from anon;
revoke all on table public.tenant_branding_profiles from anon;
revoke all on table public.user_document_profiles from anon;
revoke all on table public.proposal_documents from anon;
revoke all on table public.proposal_document_versions from anon;
revoke all on table public.proposal_options from anon;

grant select, insert, update, delete on table public.document_templates to authenticated, service_role;
grant select, insert, update, delete on table public.document_template_versions to authenticated, service_role;
grant select, insert, update, delete on table public.reusable_terms_templates to authenticated, service_role;
grant select, insert, update, delete on table public.reusable_exclusions_templates to authenticated, service_role;
grant select, insert, update, delete on table public.tenant_branding_profiles to authenticated, service_role;
grant select, insert, update, delete on table public.user_document_profiles to authenticated, service_role;
grant select, insert, update, delete on table public.proposal_documents to authenticated, service_role;
grant select, insert, update, delete on table public.proposal_document_versions to authenticated, service_role;
grant select, insert, update, delete on table public.proposal_options to authenticated, service_role;

insert into public.document_templates (
  tenant_id,
  template_key,
  family,
  name,
  description,
  active
)
values
  (
    null,
    'standard_operational_default',
    'standard_operational',
    'Standard operational proposal',
    'Default customer-facing operational proposal layout.',
    true
  ),
  (
    null,
    'formal_vendor_default',
    'formal_vendor',
    'Formal vendor proposal',
    'Structured vendor and compliance-focused proposal layout.',
    true
  )
on conflict do nothing;

insert into public.document_template_versions (
  template_id,
  version_number,
  layout_key,
  editable_regions,
  defaults,
  status
)
select
  dt.id,
  1,
  case
    when dt.template_key = 'standard_operational_default' then 'standard_operational_v1'
    else 'formal_vendor_v1'
  end,
  case
    when dt.template_key = 'standard_operational_default' then
      '["intro_text","proposal_options","terms","exclusions","notes","sender"]'::jsonb
    else
      '["intro_text","value_proposition","proposal_options","fee_rows","terms","notes","sender"]'::jsonb
  end,
  '{}'::jsonb,
  'published'
from public.document_templates dt
where dt.tenant_id is null
  and dt.template_key in ('standard_operational_default', 'formal_vendor_default')
  and not exists (
    select 1
    from public.document_template_versions dts
    where dts.template_id = dt.id
      and dts.version_number = 1
  );

insert into public.reusable_terms_templates (
  tenant_id,
  template_key,
  service_type,
  name,
  body_text,
  active
)
values
  (
    null,
    'system_default_terms',
    'general_service',
    'System default terms',
    'Pricing is based on the visible conditions and scope described in this proposal. Additional work outside the approved scope requires written approval before it is performed.' || E'\n\n' ||
    'Scheduling is subject to weather, site access, utility clearance, material availability, and any safety conditions that affect the crew''s ability to perform the work safely.' || E'\n\n' ||
    'Unless a different payment schedule is listed in the proposal, payment is due according to the approved scope and any required deposit terms shown in this document.',
    true
  ),
  (
    null,
    'system_default_terms_vendor',
    'formal_vendor',
    'System vendor terms',
    'This proposal is based on the project information available at the time of issue. Client delays, site condition changes, third-party requirements, and regulatory requirements that change the effort or sequence may require a written change authorization.' || E'\n\n' ||
    'Fees are based on the schedule, mobilization assumptions, and deliverables stated in this document. Any added work, standby time, disposal changes, permit changes, or after-hours requirements will be priced separately unless expressly included.',
    true
  )
on conflict do nothing;

insert into public.reusable_exclusions_templates (
  tenant_id,
  template_key,
  service_type,
  name,
  body_text,
  active
)
values
  (
    null,
    'system_default_exclusions_general',
    'general_service',
    'System default exclusions',
    'Unless specifically listed in the approved scope, this proposal excludes concealed conditions, permit fees, engineering, utility charges, third-party inspections, hazardous material handling, landscape or finish restoration, and work caused by site conditions that were not reasonably visible during the initial review.',
    true
  ),
  (
    null,
    'system_default_exclusions_hydrovac',
    'hydrovac_vactor',
    'System hydrovac exclusions',
    'Unless specifically listed in the approved scope, this proposal excludes traffic control beyond normal crew setup, emergency utility response charges, after-hours owner standby, contaminated material handling, disposal fees that exceed the listed assumptions, and damage caused by inaccurate locate information supplied by others.',
    true
  )
on conflict do nothing;
