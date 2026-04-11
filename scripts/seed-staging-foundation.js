#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local') });
dotenv.config({ path: path.join(repoRoot, '.env.test') });
const target = String(process.env.TEST_SITE_URL || process.env.PUBLIC_SITE_URL || '').trim();

if (!target) {
  console.error('Set TEST_SITE_URL or PUBLIC_SITE_URL before running the staging seed.');
  process.exit(1);
}

console.log(`Seeding staging foundation against ${target}`);

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsx', 'tests/seeds/seed-test-foundation.js'],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      PL_STAGING_SEED: '1',
    },
  }
);

process.exit(result.status || 0);
