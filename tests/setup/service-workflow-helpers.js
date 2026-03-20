"use strict";

const { createAdminClient } = require("./test-helpers");

const REQUIRED_TABLES = ["leads", "bids", "jobs"];
const REQUIRED_COLUMN_CHECKS = {
  customers: ["id", "tenant_id", "operator_id", "lead_source", "service_address", "billing_address", "tags"],
  orders: [
    "id",
    "tenant_id",
    "operator_id",
    "customer_id",
    "lead_id",
    "bid_id",
    "primary_job_id",
    "payment_state",
    "amount_paid_cents",
    "amount_due_cents",
    "payment_due_date",
    "deposit_required_cents",
    "deposit_paid_cents",
  ],
  payments: ["id", "tenant_id", "operator_id", "order_id", "customer_id", "job_id", "reference_number", "note", "received_at", "is_manual"],
  leads: ["id", "tenant_id", "operator_id", "customer_id", "status", "converted_bid_id", "converted_order_id", "converted_job_id"],
  bids: ["id", "tenant_id", "operator_id", "lead_id", "customer_id", "status", "converted_order_id", "line_items", "total_cents"],
  jobs: ["id", "tenant_id", "operator_id", "order_id", "customer_id", "bid_id", "status", "payment_state", "amount_paid_cents", "amount_due_cents"],
};
const REQUIRED_FUNCTIONS = [
  { name: "submit_service_lead", args: { payload: { tenant_slug: "missing", customer_name: "Missing", email: "missing@example.com", summary: "Missing" } } },
  { name: "create_bid_from_lead", args: { p_lead_id: "00000000-0000-0000-0000-000000000000", p_profile: "general_service" } },
  { name: "create_order_from_bid", args: { p_bid_id: "00000000-0000-0000-0000-000000000000" } },
  { name: "create_job_from_order", args: { p_order_id: "00000000-0000-0000-0000-000000000000" } },
];

function errorCode(error) {
  return String(error?.code || error?.error?.code || "").trim().toUpperCase();
}

function errorMessage(error) {
  return String(error?.message || error?.error?.message || "").trim();
}

function isMissingRelationError(error) {
  const code = errorCode(error);
  const message = errorMessage(error).toLowerCase();
  return code === "PGRST205"
    || code === "42P01"
    || message.includes("could not find the table")
    || message.includes("does not exist");
}

function isMissingFunctionError(error) {
  const code = errorCode(error);
  const message = errorMessage(error).toLowerCase();
  return code === "PGRST202"
    || code === "42883"
    || message.includes("could not find the function")
    || message.includes("function public.");
}

async function tableExists(admin, tableName) {
  const { error } = await admin.from(tableName).select("id").limit(1);
  if (!error) return true;
  if (isMissingRelationError(error)) return false;
  throw error;
}

async function columnsExist(admin, tableName, columns) {
  const { error } = await admin.from(tableName).select(columns.join(",")).limit(1);
  if (!error) return true;
  const code = errorCode(error);
  const message = errorMessage(error).toLowerCase();
  if (isMissingRelationError(error)) return false;
  if (code === "PGRST204" || message.includes("could not find the '")) return false;
  throw error;
}

async function rpcExists(admin, fnName, args) {
  const { error } = await admin.rpc(fnName, args);
  if (!error) return true;
  if (isMissingFunctionError(error)) return false;
  return true;
}

async function getServiceWorkflowFoundationStatus() {
  const admin = createAdminClient();
  const tables = {};
  for (const table of REQUIRED_TABLES) {
    tables[table] = await tableExists(admin, table);
  }

  const functions = {};
  for (const fn of REQUIRED_FUNCTIONS) {
    functions[fn.name] = await rpcExists(admin, fn.name, fn.args);
  }
  const columnChecks = {};
  for (const [tableName, columns] of Object.entries(REQUIRED_COLUMN_CHECKS)) {
    columnChecks[tableName] = await columnsExist(admin, tableName, columns);
  }

  const missingTables = Object.entries(tables)
    .filter(([, ready]) => !ready)
    .map(([name]) => name);
  const missingColumnChecks = Object.entries(columnChecks)
    .filter(([, ready]) => !ready)
    .map(([name]) => name);
  const missingFunctions = Object.entries(functions)
    .filter(([, ready]) => !ready)
    .map(([name]) => name);

  return {
    ready: missingTables.length === 0 && missingColumnChecks.length === 0 && missingFunctions.length === 0,
    tablesReady: missingTables.length === 0 && missingColumnChecks.length === 0,
    rpcReady: missingFunctions.length === 0,
    tables,
    functions,
    columnChecks,
    missingTables,
    missingColumnChecks,
    missingFunctions,
  };
}

function buildServiceWorkflowFoundationMessage(status) {
  const missing = [
    ...status.missingTables.map((name) => `table:${name}`),
    ...status.missingColumnChecks.map((name) => `columns:${name}`),
    ...status.missingFunctions.map((name) => `rpc:${name}`),
  ];
  return [
    "Service workflow foundation is missing from the target Supabase project.",
    missing.length ? `Missing objects: ${missing.join(", ")}` : null,
    "Apply sql/catchup_run_this.sql first, then apply sql/service_workflow_phase1.sql, rerun npm run test:preflight:service-workflow, and only then run the service-workflow integration or e2e suites.",
  ].filter(Boolean).join(" ");
}

async function assertServiceWorkflowFoundation() {
  const status = await getServiceWorkflowFoundationStatus();
  if (!status.ready) {
    throw new Error(buildServiceWorkflowFoundationMessage(status));
  }
  return status;
}

async function assertServiceWorkflowTablesReady() {
  const status = await getServiceWorkflowFoundationStatus();
  if (!status.tablesReady) {
    throw new Error(buildServiceWorkflowFoundationMessage(status));
  }
  return status;
}

function serviceWorkflowStamp(label = "service") {
  return `pltest-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function waitForResult(run, { timeoutMs = 5000, intervalMs = 150 } = {}) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) <= timeoutMs) {
    const value = await run();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for service workflow state.`);
}

async function waitForOrderPaymentState(admin, orderId, expectedState, options = {}) {
  return waitForResult(async () => {
    const { data, error } = await admin
      .from("orders")
      .select("id,payment_state,amount_paid_cents,amount_due_cents")
      .eq("id", orderId)
      .single();
    if (error) throw error;
    return String(data?.payment_state || "").trim().toLowerCase() === String(expectedState || "").trim().toLowerCase()
      ? data
      : null;
  }, options);
}

module.exports = {
  assertServiceWorkflowFoundation,
  assertServiceWorkflowTablesReady,
  buildServiceWorkflowFoundationMessage,
  errorCode,
  errorMessage,
  getServiceWorkflowFoundationStatus,
  isMissingFunctionError,
  isMissingRelationError,
  serviceWorkflowStamp,
  waitForOrderPaymentState,
  waitForResult,
};
