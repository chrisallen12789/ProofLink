"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const envExamplePath = path.join(repoRoot, ".env.example");
const netlifyTomlPath = path.join(repoRoot, "netlify.toml");
const functionsDir = path.join(repoRoot, "netlify", "functions");

const REQUIRED_RUNTIME_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "RESEND_API_KEY",
  "FROM_EMAIL",
  "MAIL_FROM",
  "MAIL_TO",
  "OPERATOR_ALERT_EMAIL",
  "SITE_URL",
  "PUBLIC_SITE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_CALENDAR_REDIRECT_URI",
  "INTERNAL_SECRET",
  "PLATFORM_NAME",
  "MAX_TESTER_SLOTS",
  "PROOFLINK_DEFAULT_APPLICATION_FEE_BPS",
];

const SCHEDULED_FUNCTIONS = [
  "booking-reminders",
  "platform-abuse-monitor",
  "process-recurring-orders",
];

function uniqueSorted(items) {
  return [...new Set(items)].sort();
}

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseEnvExample(content) {
  return uniqueSorted(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=", 1)[0])
  );
}

function diff(reference, target) {
  return {
    missing: reference.filter((item) => !target.includes(item)),
    extra: target.filter((item) => !reference.includes(item)),
  };
}

function printList(label, items) {
  if (!items.length) return;
  console.error(`${label}: ${items.join(", ")}`);
}

function verifyRuntimeEnvContract() {
  const envKeys = parseEnvExample(readFile(envExamplePath));
  const difference = diff(REQUIRED_RUNTIME_KEYS, envKeys);

  if (difference.missing.length) {
    printList(".env.example is missing required runtime keys", difference.missing);
    return false;
  }

  console.log(`OK .env.example includes ${REQUIRED_RUNTIME_KEYS.length} required runtime keys.`);
  return true;
}

function verifyScheduledFunctions() {
  const netlifyToml = readFile(netlifyTomlPath);
  let ok = true;

  for (const functionName of SCHEDULED_FUNCTIONS) {
    const functionFile = path.join(functionsDir, `${functionName}.js`);
    if (!fs.existsSync(functionFile)) {
      console.error(`Missing scheduled function file: netlify/functions/${functionName}.js`);
      ok = false;
    }

    const blockPattern = new RegExp(`\\[functions\\."${functionName}"\\][\\s\\S]*?schedule\\s*=\\s*"[^"]+"`, "m");
    if (!blockPattern.test(netlifyToml)) {
      console.error(`Missing Netlify schedule declaration for ${functionName} in netlify.toml`);
      ok = false;
    }
  }

  if (ok) {
    console.log(`OK scheduled functions are declared and present: ${SCHEDULED_FUNCTIONS.join(", ")}.`);
  }

  return ok;
}

function main() {
  console.log("Checking release readiness contract...");

  const envOk = verifyRuntimeEnvContract();
  const schedulesOk = verifyScheduledFunctions();

  if (!envOk || !schedulesOk) {
    process.exitCode = 1;
    console.error("Release readiness check failed. Fix the missing contract entries before deploy.");
    return;
  }

  console.log("Release readiness check passed.");
}

main();
