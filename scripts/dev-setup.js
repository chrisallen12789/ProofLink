#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const MIN_NODE_MAJOR = 18;

function log(line = "") {
  process.stdout.write(`${line}\n`);
}

function fail(message) {
  log(`ERROR: ${message}`);
  process.exitCode = 1;
}

function section(title) {
  log("");
  log(`== ${title} ==`);
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const parsed = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf("=");
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) parsed[key] = value;
  }

  return parsed;
}

function loadEnv() {
  const files = [".env", ".env.local", ".env.test"];
  const merged = {};

  for (const name of files) {
    Object.assign(merged, parseEnvFile(path.join(ROOT, name)));
  }

  return { ...merged, ...process.env };
}

function looksLikePlaceholder(value) {
  if (!value) return true;
  return /^(your-|fill_me|changeme|example|replace-me)/i.test(String(value).trim());
}

function resolveConfig(env) {
  return {
    supabaseUrl: env.TEST_SUPABASE_URL || env.SUPABASE_URL || "",
    serviceRoleKey:
      env.TEST_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "",
    anonKey: env.TEST_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "",
    siteUrl:
      env.TEST_SITE_URL || env.URL || env.SITE_URL || "http://127.0.0.1:8888",
  };
}

function validateNodeVersion() {
  section("Node Version");

  const major = Number(process.versions.node.split(".")[0]);
  log(`Detected Node.js ${process.versions.node}`);

  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    fail(`Node ${MIN_NODE_MAJOR}+ is required by package.json.`);
    return false;
  }

  log("Node version is compatible.");
  return true;
}

function validateEnv(config) {
  section("Environment Variables");

  const required = [
    ["Supabase URL", config.supabaseUrl],
    ["Supabase service role key", config.serviceRoleKey],
    ["Supabase anon key", config.anonKey],
    ["Local site URL", config.siteUrl],
  ];

  let ok = true;

  for (const [label, value] of required) {
    if (looksLikePlaceholder(value)) {
      log(`Missing or placeholder: ${label}`);
      ok = false;
    } else {
      log(`OK: ${label}`);
    }
  }

  if (!ok) {
    fail("Populate the required environment variables in .env, .env.local, or .env.test before continuing.");
  }

  return ok;
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function installDependencies() {
  section("Install Dependencies");

  const result = spawnSync(npmCommand(), ["install"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    fail("npm install failed.");
    return false;
  }

  log("Dependencies installed.");
  return true;
}

async function validateSupabaseConnectivity(config) {
  section("Supabase Connectivity");

  try {
    const healthRes = await fetch(`${config.supabaseUrl.replace(/\/+$/, "")}/auth/v1/health`, {
      method: "GET",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
      },
    });

    if (!healthRes.ok) {
      const text = await healthRes.text().catch(() => "");
      fail(`Supabase auth health check failed (${healthRes.status}). ${text.slice(0, 200)}`);
      return false;
    }

    const restCandidates = [
      "tenant_onboarding_requests",
      "tenants",
    ];

    for (const table of restCandidates) {
      const restRes = await fetch(
        `${config.supabaseUrl.replace(/\/+$/, "")}/rest/v1/${table}?select=id&limit=1`,
        {
          method: "GET",
          headers: {
            apikey: config.serviceRoleKey,
            Authorization: `Bearer ${config.serviceRoleKey}`,
          },
        }
      );

      if (restRes.ok) {
        log(`Supabase REST access OK via table "${table}".`);
        log("Supabase connectivity validated.");
        return true;
      }
    }

    fail("Supabase auth responded, but REST access validation failed for expected ProofLink tables.");
    return false;
  } catch (error) {
    fail(`Unable to connect to Supabase: ${error.message || String(error)}`);
    return false;
  }
}

function printNextSteps(config) {
  section("Start Netlify Dev");
  log("When setup is complete, start the local app with:");
  log("  npx netlify dev");
  log("");
  log("Expected local site URL:");
  log(`  ${config.siteUrl}`);
  log("");
  log("Recommended next steps:");
  log("  npm run test:cleanup");
  log("  npm run test:seed");
  log("  npm run test:integration");
}

async function main() {
  const env = loadEnv();
  const config = resolveConfig(env);

  const nodeOk = validateNodeVersion();
  const envOk = validateEnv(config);

  if (!nodeOk || !envOk) {
    process.exit(process.exitCode || 1);
  }

  const installOk = installDependencies();
  printNextSteps(config);

  if (!installOk) {
    process.exit(process.exitCode || 1);
  }

  const supabaseOk = await validateSupabaseConnectivity(config);

  if (!supabaseOk) {
    process.exit(process.exitCode || 1);
  }

  section("Done");
  log("Local development environment checks passed.");
}

main().catch((error) => {
  fail(error.message || String(error));
  process.exit(process.exitCode || 1);
});
