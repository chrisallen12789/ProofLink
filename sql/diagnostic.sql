-- ProofLink Database Diagnostic
-- Paste this into Supabase SQL Editor and share the results.
-- Shows every table, its columns, and which indexes exist.

select
  t.table_name,
  string_agg(c.column_name, ', ' order by c.ordinal_position) as columns
from information_schema.tables t
join information_schema.columns c
  on c.table_name = t.table_name
  and c.table_schema = 'public'
where t.table_schema = 'public'
  and t.table_type = 'BASE TABLE'
group by t.table_name
order by t.table_name;
