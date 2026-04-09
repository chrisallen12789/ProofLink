#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env.test') });

const repoRoot = process.cwd();
const sqlDir = path.join(repoRoot, 'sql');
const migrationDir = path.join(repoRoot, 'supabase', 'migrations');
const scanRoots = [
  path.join(repoRoot, 'netlify', 'functions'),
  path.join(repoRoot, 'operator'),
  path.join(repoRoot, 'admin'),
  path.join(repoRoot, 'crew'),
  path.join(repoRoot, 'scripts'),
  path.join(repoRoot, 'tests'),
];

const OPTIONAL_RPCS = new Set(['exec_migration', 'run_sql']);
const RPC_PROBES = {
  increment_invoice_counter: { p_tenant_id: '00000000-0000-0000-0000-000000000000', p_year: 2026 },
  exec_migration: { sql: 'select 1;' },
  run_sql: { query: 'select 1;' },
};

function listFiles(root, matcher) {
  const files = [];
  function walk(current) {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(fullPath);
        continue;
      }
      if (matcher(fullPath)) files.push(fullPath);
    }
  }
  walk(root);
  return files;
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function normalizeBaseMigrationName(fileName) {
  return fileName.replace(/^\d+_/, '');
}

function collectReferencedNames(files, regex) {
  const names = new Map();
  for (const file of files) {
    const text = readText(file);
    let match;
    while ((match = regex.exec(text))) {
      const name = String(match[1] || '').trim();
      if (!name) continue;
      if (!names.has(name)) names.set(name, new Set());
      names.get(name).add(path.relative(repoRoot, file));
    }
    regex.lastIndex = 0;
  }
  return names;
}

function collectSqlDefinitions(files, regex) {
  const names = new Set();
  for (const file of files) {
    const text = readText(file);
    let match;
    while ((match = regex.exec(text))) {
      const name = String(match[1] || '').trim();
      if (name) names.add(name);
    }
    regex.lastIndex = 0;
  }
  return names;
}

function parseMigrationList(output) {
  const local = new Set();
  const remote = new Set();
  const lines = String(output || '').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*(\d{14})\s+\|\s+(\d{14})\s+\|/);
    if (!match) continue;
    if (match[1]) local.add(match[1]);
    if (match[2]) remote.add(match[2]);
  }
  return { local, remote };
}

function tryListRemoteMigrations() {
  try {
    const output = execFileSync('supabase', ['migration', 'list', '--linked'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, ...parseMigrationList(output) };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error),
      local: new Set(),
      remote: new Set(),
    };
  }
}

function printSection(title, lines) {
  console.log(`\n${title}`);
  if (!lines.length) {
    console.log('  none');
    return;
  }
  lines.forEach((line) => console.log(`  - ${line}`));
}

function fileSourcesFor(name, sourceMap) {
  return [...(sourceMap.get(name) || [])].slice(0, 3).join(', ');
}

function getSupabaseRuntimeConfig() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.TEST_SUPABASE_URL ||
    '';
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ||
    '';
  return { url, serviceRoleKey };
}

async function probeRemoteTableStatus(client, tables) {
  const results = new Map();
  for (const table of tables) {
    const { error } = await client.from(table).select('*', { head: true, count: 'exact' }).limit(1);
    if (!error) {
      results.set(table, { exists: true });
      continue;
    }
    const missing = String(error.code || '') === 'PGRST205';
    results.set(table, {
      exists: !missing,
      code: error.code || '',
      message: error.message || '',
    });
  }
  return results;
}

async function probeRemoteRpcStatus(client, rpcs) {
  const results = new Map();
  for (const rpc of rpcs) {
    const { error } = await client.rpc(rpc, RPC_PROBES[rpc] || {});
    if (!error) {
      results.set(rpc, { exists: true });
      continue;
    }
    const missing = String(error.code || '') === 'PGRST202';
    results.set(rpc, {
      exists: !missing,
      code: error.code || '',
      message: error.message || '',
    });
  }
  return results;
}

async function main() {
  const sqlFiles = listFiles(sqlDir, (file) => file.endsWith('.sql'));
  const migrationFiles = listFiles(migrationDir, (file) => file.endsWith('.sql'));
  const appFiles = scanRoots.flatMap((root) => listFiles(root, (file) => /\.(js|sql|html)$/i.test(file)));

  const looseSqlFiles = sqlFiles
    .map((file) => path.basename(file))
    .filter((base) => !migrationFiles.some((migration) => {
      const migrationBase = path.basename(migration);
      return migrationBase === base || normalizeBaseMigrationName(migrationBase) === base;
    }))
    .sort();

  const referencedTables = collectReferencedNames(appFiles, /\.from\(\s*['"]([a-z0-9_]+)['"]\s*\)/gi);
  const referencedRpcs = collectReferencedNames(appFiles, /\.rpc\(\s*['"]([a-z0-9_]+)['"]\s*/gi);
  const trackedTables = collectSqlDefinitions(
    migrationFiles,
    /create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?([a-z0-9_]+)/gi,
  );
  const trackedFunctions = collectSqlDefinitions(
    migrationFiles,
    /create(?:\s+or\s+replace)?\s+function\s+(?:public\.)?([a-z0-9_]+)/gi,
  );

  const migrationState = tryListRemoteMigrations();
  const unappliedLocalMigrations = migrationState.ok
    ? [...migrationState.local].filter((id) => !migrationState.remote.has(id)).sort()
    : [];

  const untrackedReferencedTables = [...referencedTables.keys()].filter((name) => !trackedTables.has(name)).sort();
  const untrackedReferencedRpcs = [...referencedRpcs.keys()].filter((name) => !trackedFunctions.has(name)).sort();

  const { url, serviceRoleKey } = getSupabaseRuntimeConfig();
  let remoteTableStatus = new Map();
  let remoteRpcStatus = new Map();
  let remoteProbeError = '';

  if (url && serviceRoleKey) {
    const client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
    remoteTableStatus = await probeRemoteTableStatus(client, untrackedReferencedTables);
    remoteRpcStatus = await probeRemoteRpcStatus(client, untrackedReferencedRpcs.filter((name) => !OPTIONAL_RPCS.has(name)));
    for (const rpc of OPTIONAL_RPCS) {
      if (untrackedReferencedRpcs.includes(rpc)) {
        remoteRpcStatus.set(rpc, { exists: false, optional: true });
      }
    }
  } else {
    remoteProbeError = 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not available for live schema verification';
  }

  const remoteCoveredTables = [];
  const remoteMissingTables = [];
  untrackedReferencedTables.forEach((name) => {
    const status = remoteTableStatus.get(name);
    const sources = fileSourcesFor(name, referencedTables);
    if (status?.exists) {
      remoteCoveredTables.push(`${name} exists remotely but is not represented in tracked migrations (${sources})`);
      return;
    }
    if (status) {
      remoteMissingTables.push(`${name} missing remotely (${status.code || 'unknown'} ${status.message || ''}) referenced by ${sources}`.trim());
      return;
    }
    remoteMissingTables.push(`${name} could not be verified remotely (${sources})`);
  });

  const remoteCoveredRpcs = [];
  const remoteMissingRpcs = [];
  untrackedReferencedRpcs.forEach((name) => {
    const sources = fileSourcesFor(name, referencedRpcs);
    const status = remoteRpcStatus.get(name);
    if (status?.exists) {
      remoteCoveredRpcs.push(`${name} exists remotely but is not represented in tracked migrations (${sources})`);
      return;
    }
    if (status?.optional) {
      remoteCoveredRpcs.push(`${name} is an optional legacy helper referenced by migration tooling (${sources})`);
      return;
    }
    if (status) {
      remoteMissingRpcs.push(`${name} missing remotely (${status.code || 'unknown'} ${status.message || ''}) referenced by ${sources}`.trim());
      return;
    }
    remoteMissingRpcs.push(`${name} could not be verified remotely (${sources})`);
  });

  console.log('Supabase drift check');
  console.log(`Repo root: ${repoRoot}`);

  printSection('Legacy SQL files not yet promoted into tracked supabase/migrations', looseSqlFiles);
  printSection('Referenced tables covered in live Supabase but missing from tracked migrations', remoteCoveredTables);
  printSection('Referenced RPCs covered or intentionally optional outside tracked migrations', remoteCoveredRpcs);
  printSection('Referenced tables missing from live Supabase', remoteMissingTables);
  printSection('Referenced RPCs missing from live Supabase', remoteMissingRpcs);

  if (migrationState.ok) {
    printSection('Local migrations not yet applied remotely', unappliedLocalMigrations);
  } else {
    printSection('Remote migration list', [`unavailable: ${migrationState.error}`]);
  }

  if (remoteProbeError) {
    printSection('Live schema probe', [remoteProbeError]);
  }

  const hasBlockingIssues =
    remoteMissingTables.length > 0 ||
    remoteMissingRpcs.length > 0 ||
    unappliedLocalMigrations.length > 0 ||
    !!remoteProbeError;

  if (hasBlockingIssues) {
    process.exitCode = 1;
    return;
  }

  console.log('\nNo blocking Supabase drift detected. Remaining output above is tracking debt, not live-schema breakage.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
