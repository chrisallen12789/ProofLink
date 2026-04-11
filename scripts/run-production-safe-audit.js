#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local') });
dotenv.config({ path: path.join(repoRoot, '.env.test') });
const baseUrl = String(process.env.TEST_SITE_URL || process.env.PUBLIC_SITE_URL || '').trim();

if (!baseUrl) {
  console.error('TEST_SITE_URL is required for the production-safe audit.');
  process.exit(1);
}

console.log(`Running production-safe audit against ${baseUrl}`);

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    'playwright',
    'test',
    'tests/e2e/production-safe-audit.spec.js',
    '--config=playwright.config.js',
    '--project=chromium',
    '--workers=1',
    '--reporter=line',
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  }
);

process.exit(result.status || 0);
