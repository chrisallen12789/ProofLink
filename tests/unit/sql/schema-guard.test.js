"use strict";

const fs = require("fs");
const path = require("path");

describe("schema guards", () => {
  test("operator_members keeps the composite tenant membership constraint in the repo schema", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "sql/catchup_run_this.sql"),
      "utf8"
    );
    expect(source).toContain("create table if not exists public.operator_members");
    expect(source).toContain("primary key (operator_id, tenant_id)");
  });

  test("service recurring plans own the scheduled-date uniqueness guard in the repo schema", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "sql/service_recurring_plans.sql"),
      "utf8"
    );
    expect(source).toContain("create unique index if not exists idx_orders_service_plan_scheduled_date_unique");
    expect(source).toContain("service_plan_id, scheduled_date");
  });

  test("provision failure visibility migration exists for rollback cleanup follow-up", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "sql/provision_failures.sql"),
      "utf8"
    );
    expect(source).toContain("create table if not exists public.provision_failures");
    expect(source).toContain("rollback_issues jsonb");
    expect(source).toContain("alter table public.provision_failures enable row level security;");
    expect(source).toContain('create policy "Service role full access on provision_failures"');
    expect(source).toContain("grant select, insert, update, delete on table public.provision_failures to service_role;");
    expect(source).toContain("where onboarding_request_id is not null;");
    expect(source).toContain("where tenant_id is not null;");
  });
});
