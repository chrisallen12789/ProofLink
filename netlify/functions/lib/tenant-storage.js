const crypto = require('crypto');
const { getAdminClient } = require('../utils/auth');

const BUCKET = 'product-images';
const EXPIRY_MINUTES = 15;

function getUploadSecret() {
  const secret = String(process.env.TENANT_UPLOAD_SECRET || '').trim();
  if (secret) {
    return secret;
  }

  if (String(process.env.NODE_ENV || '').trim() === 'test') {
    return 'pltest-upload-secret';
  }

  if (!secret) {
    throw Object.assign(new Error('Upload receipt signing secret is not configured'), {
      statusCode: 500,
      code: 'upload_secret_missing',
    });
  }
}

function safeFilename(name) {
  return String(name || 'file').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9._-]/g, '');
}

function buildObjectPath({ tenantId, operatorId, folder = 'uploads', filename }) {
  return `${tenantId}/${folder}/${operatorId}/${Date.now()}_${safeFilename(filename)}`;
}

function makeReceipt({ tenantId, operatorId, objectPath, expectedBytes, contentType, slot, folder }) {
  const payload = {
    tenantId,
    operatorId,
    objectPath,
    expectedBytes: Number(expectedBytes || 0),
    contentType: String(contentType || ''),
    slot: String(slot || ''),
    folder: String(folder || ''),
    exp: Date.now() + (EXPIRY_MINUTES * 60 * 1000),
  };
  const secret = getUploadSecret();
  const body = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return Buffer.from(JSON.stringify({ payload, sig }), 'utf8').toString('base64url');
}

function parseReceipt(receipt) {
  if (!receipt) throw Object.assign(new Error('Missing receipt'), { statusCode: 400 });
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(receipt), 'base64url').toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid receipt'), { statusCode: 400 });
  }
  const secret = getUploadSecret();
  const body = JSON.stringify(parsed.payload || {});
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  if (sig !== parsed.sig) throw Object.assign(new Error('Receipt signature mismatch'), { statusCode: 403 });
  if ((parsed.payload?.exp || 0) < Date.now()) throw Object.assign(new Error('Receipt expired'), { statusCode: 410 });
  return parsed.payload;
}

async function callRpcMaybe(supabase, fn, args) {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw error;
    return data;
  } catch (error) {
    return { __rpc_error: error.message || String(error) };
  }
}

async function findTenant(supabase, tenantId) {
  const strategies = [
    () => supabase.from('tenants').select('id, tenant_id, slug, storage_used_mb, max_storage_mb').eq('id', tenantId).maybeSingle(),
    () => supabase.from('tenants').select('id, tenant_id, slug, storage_used_mb, max_storage_mb').eq('tenant_id', tenantId).maybeSingle(),
    () => supabase.from('tenants').select('id, tenant_id, slug, storage_used_mb, max_storage_mb').eq('slug', tenantId).maybeSingle(),
  ];
  for (const run of strategies) {
    const { data, error } = await run();
    if (!error && data) return data;
  }
  throw Object.assign(new Error('Tenant not found for storage check'), { statusCode: 404 });
}

async function checkStorageLimit({ tenantId, incomingBytes }) {
  const supabase = getAdminClient();
  const bytes = Number(incomingBytes || 0);
  const mb = bytes / (1024 * 1024);
  const result = await callRpcMaybe(supabase, 'check_storage_limit', {
    p_tenant_id: tenantId,
    p_bytes: bytes,
    p_storage_mb: mb,
    tenant_id: tenantId,
    bytes,
    storage_mb: mb,
  });

  if (result && !result.__rpc_error) {
    if (result === true) return { ok: true, via: 'rpc' };
    if (typeof result === 'object' && result.ok === false) return { ok: false, via: 'rpc', error: result.error || 'Storage limit reached' };
    return { ok: true, via: 'rpc', result };
  }

  const tenant = await findTenant(supabase, tenantId);
  const used = Number(tenant.storage_used_mb || 0);
  const max = Number(tenant.max_storage_mb || 0);
  if (max > 0 && used + mb > max) {
    return { ok: false, via: 'fallback', error: 'Storage limit reached', used, max, incoming_mb: mb };
  }
  return { ok: true, via: 'fallback', used, max, incoming_mb: mb };
}

async function incrementStorageUsage({ tenantId, bytes }) {
  const supabase = getAdminClient();
  const amountBytes = Number(bytes || 0);
  const mb = amountBytes / (1024 * 1024);
  const result = await callRpcMaybe(supabase, 'increment_tenant_storage_usage', {
    p_tenant_id: tenantId,
    p_bytes: amountBytes,
    p_storage_mb: mb,
    tenant_id: tenantId,
    bytes: amountBytes,
    storage_mb: mb,
  });
  if (result && !result.__rpc_error) return { ok: true, via: 'rpc', result };

  const tenant = await findTenant(supabase, tenantId);
  const nextValue = Number(tenant.storage_used_mb || 0) + mb;
  const { error } = await supabase.from('tenants').update({ storage_used_mb: nextValue }).eq('id', tenant.id);
  if (error) {
    throw Object.assign(new Error(error.message || 'Unable to increment storage fallback'), { statusCode: 500 });
  }
  return { ok: true, via: 'fallback', storage_used_mb: nextValue };
}

async function readUploadedObjectBytes(objectPath) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .schema('storage')
    .from('objects')
    .select('name, metadata')
    .eq('bucket_id', BUCKET)
    .eq('name', objectPath)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw Object.assign(new Error('Uploaded file not found in storage'), { statusCode: 404 });
  }

  const size = Number(data.metadata?.size || data.metadata?.size_bytes || 0);
  return { size, metadata: data.metadata || {} };
}

module.exports = {
  BUCKET,
  buildObjectPath,
  getUploadSecret,
  makeReceipt,
  parseReceipt,
  checkStorageLimit,
  incrementStorageUsage,
  readUploadedObjectBytes,
};
