#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const dotenv = require('dotenv');

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env.test');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function loadTestEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    fail('Missing .env.test. Create it from .env.test.example before starting test Netlify dev.');
  }

  const result = dotenv.config({ path: ENV_PATH });
  if (result.error) {
    fail(`Unable to read .env.test: ${result.error.message || String(result.error)}`);
  }

  return result.parsed || {};
}

function requiredValue(source, key) {
  const value = String(source[key] || process.env[key] || '').trim();
  if (!value) {
    fail(`Missing required ${key} in .env.test for test Netlify dev.`);
  }
  return value;
}

function resolveEnv() {
  const parsed = loadTestEnv();
  const testSupabaseUrl = requiredValue(parsed, 'TEST_SUPABASE_URL');
  const testServiceRoleKey = requiredValue(parsed, 'TEST_SUPABASE_SERVICE_ROLE_KEY');
  const testAnonKey = requiredValue(parsed, 'TEST_SUPABASE_ANON_KEY');
  const testSiteUrl = requiredValue(parsed, 'TEST_SITE_URL');

  return {
    ...process.env,
    ...parsed,
    SUPABASE_URL: testSupabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: testServiceRoleKey,
    SUPABASE_ANON_KEY: testAnonKey,
    SITE_URL: testSiteUrl,
    PUBLIC_SITE_URL: testSiteUrl,
    URL: testSiteUrl,
  };
}

function maskedKey(value) {
  const normalized = String(value || '');
  return normalized ? `${normalized.slice(0, 8)}...(${normalized.length})` : '(missing)';
}

function npxCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function spawnConfigForNetlify(args) {
  if (process.platform === 'win32') {
    const command = ['npx', ...args].join(' ');
    return {
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', command],
    };
  }

  return {
    file: npxCommand(),
    args,
  };
}

function main() {
  const env = resolveEnv();
  const extraArgs = process.argv.slice(2);
  const portIndex = extraArgs.findIndex((arg) => arg === '--port');
  const port = portIndex >= 0 ? extraArgs[portIndex + 1] : '8888';
  const args =
    portIndex >= 0
      ? ['netlify', 'dev', ...extraArgs]
      : ['netlify', 'dev', '--port', port, ...extraArgs];
  const spawnConfig = spawnConfigForNetlify(args);

  process.stdout.write(`Starting test Netlify dev on ${env.TEST_SITE_URL}\n`);
  process.stdout.write(`Using Supabase host ${env.TEST_SUPABASE_URL}\n`);
  process.stdout.write(`Using service-role key ${maskedKey(env.TEST_SUPABASE_SERVICE_ROLE_KEY)}\n`);

  const child = spawn(spawnConfig.file, spawnConfig.args, {
    cwd: ROOT,
    env,
    stdio: 'inherit',
    shell: false,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code == null ? 1 : code);
  });

  child.on('error', (error) => {
    fail(`Unable to start Netlify dev: ${error.message || String(error)}`);
  });
}

main();
