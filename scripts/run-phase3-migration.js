#!/usr/bin/env node
// Run via: node scripts/run-phase3-migration.js
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_REF = 'ygfpawksbqfbgohztisv';
const PAT = 'sbp_v0_ff39e6037fcf82427f0c56ae74dce443ff5477ae';
const SQL_FILE = path.join(__dirname, 'phase3-schema.sql');

const sql = fs.readFileSync(SQL_FILE, 'utf8');
const body = JSON.stringify({ query: sql });

const options = {
  hostname: 'api.supabase.com',
  path: `/v1/projects/${PROJECT_REF}/database/query`,
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${PAT}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try {
      const parsed = JSON.parse(data);
      if (res.statusCode === 200 || res.statusCode === 201) {
        console.log('Migration succeeded.');
        console.log(JSON.stringify(parsed, null, 2));
      } else {
        console.error('Migration failed:', JSON.stringify(parsed, null, 2));
        process.exit(1);
      }
    } catch {
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (e) => { console.error('Request error:', e); process.exit(1); });
req.write(body);
req.end();
