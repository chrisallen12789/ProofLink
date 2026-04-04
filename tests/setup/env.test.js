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

function normalizeEnvValue(value) {
  return String(value || "").trim();
}

function isManagedPltestEmail(value) {
  return /^pltest\.[^@\s]+@example\.com$/i.test(normalizeEnvValue(value));
}

function placeholderEnvIssues(keys = REQUIRED_ENV_KEYS) {
  const issues = [];

  keys.forEach((key) => {
    const value = normalizeEnvValue(process.env[key]);
    if (!value) return;

    if (["TEST_PLATFORM_ADMIN_PASSWORD", "TEST_TENANT_A_ADMIN_PASSWORD", "TEST_TENANT_B_ADMIN_PASSWORD"].includes(key)) {
      if (/^change-me$/i.test(value)) {
        issues.push(`${key} is still set to the template password.`);
      }
      return;
    }

    if (["TEST_PLATFORM_ADMIN_EMAIL", "TEST_TENANT_A_ADMIN_EMAIL", "TEST_TENANT_B_ADMIN_EMAIL"].includes(key)) {
      if (/@example\.com$/i.test(value) && !isManagedPltestEmail(value)) {
        issues.push(`${key} is still set to a placeholder example.com account.`);
      }
      return;
    }

    if (key === "TEST_SUPABASE_URL") {
      if (/your-project\.supabase\.co/i.test(value)) {
        issues.push(`${key} is still set to the template Supabase host.`);
        return;
      }
      try {
        const parsed = new URL(value);
        if (!/^https?:$/i.test(parsed.protocol)) {
          issues.push(`${key} must use http or https.`);
        }
      } catch (_) {
        issues.push(`${key} is not a valid URL.`);
      }
      return;
    }

    if (["TEST_SUPABASE_SERVICE_ROLE_KEY", "TEST_SUPABASE_ANON_KEY"].includes(key)) {
      if (value === "..." || /^(your-|example-|changeme)/i.test(value)) {
        issues.push(`${key} is still set to a template API key.`);
      }
    }
  });

  return issues;
}

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

  const placeholderIssues = placeholderEnvIssues([...REQUIRED_ENV_KEYS, ...extraKeys]);
  if (placeholderIssues.length) {
    throw new Error(
      `Invalid test environment values detected: ${placeholderIssues.join(" ")} Update .env.test with real non-template credentials before running hosted tests.`
    );
  }
}

module.exports = {
  ENV_PATH,
  REQUIRED_ENV_KEYS,
  assertRequiredEnv,
  loadTestEnv,
  placeholderEnvIssues,
};
