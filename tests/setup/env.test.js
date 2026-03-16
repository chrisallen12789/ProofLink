"use strict";

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const ENV_PATH = path.resolve(process.cwd(), ".env.test");
const REQUIRED_ENV_KEYS = [
  "TEST_SUPABASE_URL",
  "TEST_SUPABASE_SERVICE_ROLE_KEY",
  "TEST_SUPABASE_ANON_KEY",
  "TEST_SITE_URL",
  "TEST_PLATFORM_ADMIN_EMAIL",
  "TEST_PLATFORM_ADMIN_PASSWORD",
  "TEST_TENANT_A_ADMIN_EMAIL",
  "TEST_TENANT_A_ADMIN_PASSWORD",
  "TEST_TENANT_B_ADMIN_EMAIL",
  "TEST_TENANT_B_ADMIN_PASSWORD",
];

let loaded = false;

function loadTestEnv() {
  if (loaded) return;
  if (fs.existsSync(ENV_PATH)) {
    dotenv.config({ path: ENV_PATH });
  }

  process.env.SUPABASE_URL = process.env.SUPABASE_URL || process.env.TEST_SUPABASE_URL || "";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || "";
  process.env.SUPABASE_ANON_KEY =
    process.env.SUPABASE_ANON_KEY || process.env.TEST_SUPABASE_ANON_KEY || "";
  process.env.SITE_URL = process.env.SITE_URL || process.env.TEST_SITE_URL || "";
  process.env.URL = process.env.URL || process.env.TEST_SITE_URL || "";
  process.env.PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || process.env.TEST_SITE_URL || "";

  loaded = true;
}

function assertRequiredEnv(extraKeys = []) {
  loadTestEnv();
  const missing = [...REQUIRED_ENV_KEYS, ...extraKeys].filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `Missing required test environment variables: ${missing.join(", ")}. Create .env.test from .env.test.example.`
    );
  }
}

module.exports = {
  ENV_PATH,
  REQUIRED_ENV_KEYS,
  assertRequiredEnv,
  loadTestEnv,
};
