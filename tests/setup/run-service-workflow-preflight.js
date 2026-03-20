"use strict";

const path = require("path");

const { assertRequiredEnv, loadTestEnv } = require("./env.test");
const { assertServiceWorkflowFoundation, getServiceWorkflowFoundationStatus } = require("./service-workflow-helpers");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CATCHUP_SQL_PATH = path.join(REPO_ROOT, "sql", "catchup_run_this.sql");
const SERVICE_WORKFLOW_SQL_PATH = path.join(REPO_ROOT, "sql", "service_workflow_phase1.sql");

function printRemediation() {
  console.error("Hosted service workflow rollout required:");
  console.error(`1. Run ${CATCHUP_SQL_PATH} in the target Supabase SQL Editor.`);
  console.error(`2. Run ${SERVICE_WORKFLOW_SQL_PATH} in the same Supabase project.`);
  console.error("3. Rerun: npm run test:preflight:service-workflow");
  console.error("4. Then run: npm run test:integration:service-workflow");
  console.error("5. Then start Netlify dev and run: npm run test:e2e:service-workflow");
}

async function main() {
  loadTestEnv();
  assertRequiredEnv();

  try {
    const status = await assertServiceWorkflowFoundation();
    console.log("Service workflow preflight passed.");
    console.log(JSON.stringify(status, null, 2));
  } catch (error) {
    const status = await getServiceWorkflowFoundationStatus().catch(() => null);
    console.error(error.message || String(error));
    if (status) {
      console.error(JSON.stringify(status, null, 2));
    }
    printRemediation();
    process.exitCode = 1;
  }
}

main();
