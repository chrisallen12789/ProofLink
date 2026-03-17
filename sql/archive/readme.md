# Archive — Do Not Run

These files are the original incremental migration scripts from earlier development. They are preserved here for historical reference only.

**Everything in these files is already covered by `../CATCHUP_RUN_THIS.sql`.**

Do not run any of these files against your database. Several contain:
- Backfills to old test tenant data ("honest-to-crust")
- References to old table names that no longer exist
- Duplicate `CREATE TABLE` statements that will conflict
- Outdated RLS policies that have been superseded

If you need to understand the history of how the schema evolved, these files tell that story in order.

If you need to repair an older hosted environment, prefer the active helper scripts in the parent `sql/` directory, such as `get_tenant_plan_limits_compat.sql`, instead of running anything from `archive/`.
