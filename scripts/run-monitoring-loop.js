#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local') });
dotenv.config({ path: path.join(repoRoot, '.env.test') });

const testSiteUrl = String(process.env.TEST_SITE_URL || process.env.PUBLIC_SITE_URL || '').trim();

const commands = [
  ['node', ['scripts/verify-release-readiness.js']],
  ['node', ['scripts/check-supabase-drift.js']],
];

if (testSiteUrl) {
  commands.push(['node', ['scripts/run-production-safe-audit.js']]);
}

for (const [command, args] of commands) {
  const runner = process.platform === 'win32' && command === 'npx' ? 'npx.cmd' : command;
  const result = spawnSync(runner, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
