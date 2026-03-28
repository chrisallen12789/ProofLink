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

  test("recurring order idempotency migration exists with the scheduled-date unique index", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "sql/recurring_orders_idempotency.sql"),
      "utf8"
    );
    expect(source).toContain("create unique index if not exists idx_orders_recurring_scheduled_date_unique");
    expect(source).toContain("recurring_id, scheduled_date");
  });

  test("provision failure visibility migration exists for rollback cleanup follow-up", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "sql/provision_failures.sql"),
      "utf8"
    );
    expect(source).toContain("create table if not exists public.provision_failures");
    expect(source).toContain("rollback_issues jsonb");
  });
});
