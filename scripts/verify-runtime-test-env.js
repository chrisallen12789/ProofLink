"use strict";

const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const { ENV_PATH, assertRequiredEnv, loadTestEnv } = require(path.join(repoRoot, "tests/setup/env.test.js"));

function mask(value = "") {
  if (!value) return "<empty>";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function printDebugHints() {
  const url = process.env.TEST_SUPABASE_URL || "";
  const serviceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || "";
  const anonKey = process.env.TEST_SUPABASE_ANON_KEY || "";

  console.error(`Loaded env file: ${ENV_PATH}`);
  console.error(`TEST_SUPABASE_URL=${url || "<missing>"}`);
  console.error(`TEST_SUPABASE_SERVICE_ROLE_KEY=${mask(serviceKey)}`);
  console.error(`TEST_SUPABASE_ANON_KEY=${mask(anonKey)}`);
  if (/your-project\.supabase\.co/i.test(url)) {
    console.error("Detected placeholder Supabase host (your-project.supabase.co). Replace it with your real project URL.");
  }
}

function main() {
  try {
    loadTestEnv();
    assertRequiredEnv();
    console.log("Runtime TEST_* environment check passed.");
  } catch (error) {
    console.error(error.message || String(error));
    printDebugHints();
    console.error("Create .env.test from .env.test.example and replace all placeholder values before integration tests.");
    process.exitCode = 1;
  }
}

main();
