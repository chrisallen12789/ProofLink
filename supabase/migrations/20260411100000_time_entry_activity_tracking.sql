alter table if exists public.time_entries
  add column if not exists member_id uuid,
  add column if not exists work_type text not null default 'job_work',
  add column if not exists training_type text,
  add column if not exists maintenance_type text,
  add column if not exists asset_category text,
  add column if not exists asset_label text,
  add column if not exists cost_bucket text not null default 'direct_job';

create index if not exists idx_time_entries_member_id on public.time_entries(member_id);
create index if not exists idx_time_entries_work_type on public.time_entries(work_type);
create index if not exists idx_time_entries_cost_bucket on public.time_entries(cost_bucket);

