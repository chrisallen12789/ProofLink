#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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
const definedTables = collectSqlDefinitions(
  [...sqlFiles, ...migrationFiles],
  /create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?([a-z0-9_]+)/gi,
);
const definedFunctions = collectSqlDefinitions(
  [...sqlFiles, ...migrationFiles],
  /create(?:\s+or\s+replace)?\s+function\s+(?:public\.)?([a-z0-9_]+)/gi,
);

const missingTrackedTables = [...referencedTables.entries()]
  .filter(([name]) => !definedTables.has(name))
  .map(([name, files]) => `${name} referenced by ${[...files].slice(0, 3).join(', ')}`)
  .sort();

const missingTrackedRpcs = [...referencedRpcs.entries()]
  .filter(([name]) => !definedFunctions.has(name))
  .map(([name, files]) => `${name} referenced by ${[...files].slice(0, 3).join(', ')}`)
  .sort();

const migrationState = tryListRemoteMigrations();
const unappliedLocalMigrations = migrationState.ok
  ? [...migrationState.local].filter((id) => !migrationState.remote.has(id)).sort()
  : [];

console.log('Supabase drift check');
console.log(`Repo root: ${repoRoot}`);

printSection('Loose SQL files without tracked supabase/migrations entries', looseSqlFiles);
printSection('Referenced tables missing from tracked SQL definitions', missingTrackedTables);
printSection('Referenced RPCs missing from tracked SQL definitions', missingTrackedRpcs);

if (migrationState.ok) {
  printSection('Local migrations not yet applied remotely', unappliedLocalMigrations);
} else {
  printSection('Remote migration list', [`unavailable: ${migrationState.error}`]);
}

const hasIssues =
  looseSqlFiles.length > 0 ||
  missingTrackedTables.length > 0 ||
  missingTrackedRpcs.length > 0 ||
  unappliedLocalMigrations.length > 0;

if (hasIssues) {
  process.exitCode = 1;
} else {
  console.log('\nNo schema drift signals detected from tracked SQL, app references, and linked remote migrations.');
}
