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
const PLACEHOLDER_RULES = [
  {
    key: "TEST_SUPABASE_URL",
    reason: "must point to a real Supabase project URL",
    matches: (value) => /your-project\.supabase\.co/i.test(value),
  },
  {
    key: "TEST_SUPABASE_SERVICE_ROLE_KEY",
    reason: "must be a real service role key",
    matches: (value) => /^your-service-role-key$/i.test(value),
  },
  {
    key: "TEST_SUPABASE_ANON_KEY",
    reason: "must be a real anon key",
    matches: (value) => /^your-anon-key$/i.test(value),
  },
  {
    key: "TEST_PLATFORM_ADMIN_EMAIL",
    reason: "must not use template placeholder email",
    matches: (value) => /^platform-admin@example\.com$/i.test(value),
  },
  {
    key: "TEST_TENANT_A_ADMIN_EMAIL",
    reason: "must not use template placeholder email",
    matches: (value) => /^tenant-a-admin@example\.com$/i.test(value),
  },
  {
    key: "TEST_TENANT_B_ADMIN_EMAIL",
    reason: "must not use template placeholder email",
    matches: (value) => /^tenant-b-admin@example\.com$/i.test(value),
  },
  {
    key: "TEST_PLATFORM_ADMIN_PASSWORD",
    reason: "must be a real test password (not change-me)",
    matches: (value) => /^change-me$/i.test(value),
  },
  {
    key: "TEST_TENANT_A_ADMIN_PASSWORD",
    reason: "must be a real test password (not change-me)",
    matches: (value) => /^change-me$/i.test(value),
  },
  {
    key: "TEST_TENANT_B_ADMIN_PASSWORD",
    reason: "must be a real test password (not change-me)",
    matches: (value) => /^change-me$/i.test(value),
  },
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
  const placeholders = PLACEHOLDER_RULES.filter((rule) => {
    const value = process.env[rule.key];
    return value && rule.matches(value);
  });
  if (missing.length) {
    throw new Error(
      `Missing required test environment variables: ${missing.join(", ")}. Create .env.test from .env.test.example.`
    );
  }
  if (placeholders.length) {
    const placeholderMessage = placeholders.map((rule) => `${rule.key} (${rule.reason})`).join(", ");
    throw new Error(
      `Placeholder test environment values detected: ${placeholderMessage}. Replace placeholder values in .env.test before running hosted tests.`
    );
  }
}

module.exports = {
  ENV_PATH,
  REQUIRED_ENV_KEYS,
  assertRequiredEnv,
  loadTestEnv,
};
