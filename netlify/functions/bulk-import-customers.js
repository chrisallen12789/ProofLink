// netlify/functions/bulk-import-customers.js
// Bulk-imports customers for the authenticated operator's tenant.
// POST { customers: [{name, email, phone, address_line1, city, state, zip, notes}] }
// Deduplicates by email against existing customers, skips duplicates.
// Returns { imported: N, skipped: N, errors: [...] }

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BATCH = 200;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { customers } = body;

  if (!Array.isArray(customers) || customers.length === 0) {
    return respond(400, { error: 'customers must be a non-empty array' });
  }
  if (customers.length > MAX_BATCH) {
    return respond(400, { error: `Maximum ${MAX_BATCH} customers per request` });
  }

  // Validate rows and collect emails present in the batch
  const validRows  = [];
  const errors     = [];
  const batchEmails = new Set();

  for (let i = 0; i < customers.length; i++) {
    const row = customers[i];
    const idx = i + 1;

    if (!row || typeof row !== 'object') {
      errors.push({ row: idx, error: 'Row must be an object' });
      continue;
    }

    const name = String(row.name || '').trim();
    if (!name) {
      errors.push({ row: idx, error: 'name is required' });
      continue;
    }

    const email = row.email ? String(row.email).trim().toLowerCase() : null;
    if (email && !EMAIL_RE.test(email)) {
      errors.push({ row: idx, error: `Invalid email: ${row.email}` });
      continue;
    }

    validRows.push({
      idx,
      name,
      email,
      phone         : row.phone   ? String(row.phone).trim()          : null,
      address_line1 : row.address_line1 ? String(row.address_line1).trim() : null,
      address_line2 : row.address_line2 ? String(row.address_line2).trim() : null,
      city          : row.city    ? String(row.city).trim()           : null,
      state         : row.state   ? String(row.state).trim()          : null,
      zip           : row.zip     ? String(row.zip).trim()            : null,
      notes         : row.notes   ? String(row.notes).trim()          : null,
    });

    if (email) batchEmails.add(email);
  }

  // Fetch existing customers by email to deduplicate
  const existingEmailSet = new Set();
  if (batchEmails.size > 0) {
    const emailsArray = Array.from(batchEmails);
    const { data: existing, error: existingErr } = await supabase
      .from('customers')
      .select('email')
      .eq('tenant_id', tenantId)
      .in('email', emailsArray);

    if (existingErr) {
      console.error('[bulk-import-customers] existing lookup:', existingErr);
      return respond(500, { error: 'Failed to check for existing customers' });
    }

    for (const c of (existing || [])) {
      if (c.email) existingEmailSet.add(c.email.toLowerCase());
    }
  }

  const toInsert = [];
  let skipped    = 0;

  for (const row of validRows) {
    // Skip if email already exists in the tenant
    if (row.email && existingEmailSet.has(row.email)) {
      skipped++;
      continue;
    }
    // Also deduplicate within the batch itself (second row with same email = skip)
    if (row.email && existingEmailSet.has(row.email)) {
      skipped++;
      continue;
    }

    toInsert.push({
      tenant_id    : tenantId,
      name         : row.name,
      email        : row.email || null,
      phone        : row.phone || null,
      address_line1: row.address_line1 || null,
      address_line2: row.address_line2 || null,
      city         : row.city || null,
      state        : row.state || null,
      zip          : row.zip || null,
      notes        : row.notes || null,
      created_at   : new Date().toISOString(),
    });

    // Track in-batch dedup
    if (row.email) existingEmailSet.add(row.email);
  }

  let imported = 0;
  if (toInsert.length > 0) {
    const { data: inserted, error: insertErr } = await supabase
      .from('customers')
      .insert(toInsert)
      .select('id');

    if (insertErr) {
      console.error('[bulk-import-customers] insert:', insertErr);
      return respond(500, { error: 'Failed to import customers' });
    }

    imported = inserted ? inserted.length : 0;
  }

  return respond(200, {
    ok     : true,
    imported,
    skipped,
    errors,
  });
};
