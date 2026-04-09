"use strict";

const fs = require("fs");
const path = require("path");

describe("employee compensation schema guards", () => {
  test("foundation SQL tracks union contracts, member assignments, overrides, and audit output", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "sql/employee_compensation_foundation.sql"),
      "utf8"
    );

    expect(source).toContain("create table if not exists public.labor_contracts");
    expect(source).toContain("create table if not exists public.member_compensation_assignments");
    expect(source).toContain("create table if not exists public.member_compensation_overrides");
    expect(source).toContain("create table if not exists public.compensation_audit_log");
    expect(source).toContain("add column if not exists worker_label text");
    expect(source).toContain("add column if not exists driver_label text");
    expect(source).toContain("grant select, insert, update, delete on table public.member_compensation_assignments to authenticated, service_role;");
  });

  test("supabase migration inlines the compensation foundation instead of using shell includes", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20260409110000_employee_compensation_foundation.sql"),
      "utf8"
    );

    expect(source).toContain("create table if not exists public.labor_contracts");
    expect(source).not.toContain("\\i ../sql/employee_compensation_foundation.sql");
  });
});
