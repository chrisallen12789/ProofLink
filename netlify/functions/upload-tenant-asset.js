const { requireOperatorContext, respond } = require('./utils/auth');
const { BUCKET, buildObjectPath, makeReceipt, checkStorageLimit } = require('./lib/tenant-storage');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, { ok: true });
  if (event.httpMethod !== 'POST') return respond(405, { ok: false, error: 'Method not allowed' });

  try {
    const body = JSON.parse(event.body || '{}');
    const requestedTenantId = String(body.tenant_id || '').trim();
    const ctx = await requireOperatorContext(event, requestedTenantId);
    const tenantId = String(requestedTenantId || ctx.tenantId || '').trim();
    const operatorId = String(ctx.operatorId || '').trim();
    const filename = String(body.filename || 'file').trim();
    const contentType = String(body.content_type || body.contentType || 'application/octet-stream').trim();
    const bytes = Number(body.bytes || body.size || 0);
    const folder = String(body.folder || 'uploads').trim();
    const slot = String(body.slot || '').trim();

    if (!tenantId) return respond(400, { ok: false, error: 'Missing tenant_id' });
    if (!operatorId) return respond(403, { ok: false, error: 'Missing operator context' });
    if (!filename || !bytes || bytes <= 0) return respond(400, { ok: false, error: 'Missing filename or bytes' });
    if (ctx.role !== 'admin' && ctx.role !== 'platform_admin' && ctx.tenantId && ctx.tenantId !== tenantId) {
      return respond(403, { ok: false, error: 'Forbidden: tenant mismatch' });
    }

    const check = await checkStorageLimit({ tenantId, incomingBytes: bytes });
    if (!check.ok) {
      return respond(409, {
        ok: false,
        code: 'storage_limit_reached',
        error: check.error || 'Storage limit reached',
        check,
      });
    }

    const objectPath = buildObjectPath({ tenantId, operatorId, folder, filename });
    const receipt = makeReceipt({ tenantId, operatorId, objectPath, expectedBytes: bytes, contentType, slot, folder });

    return respond(200, {
      ok: true,
      bucket: BUCKET,
      objectPath,
      receipt,
      contentType,
      storageCheck: check,
    });
  } catch (error) {
    console.error('upload-tenant-asset error:', error);
    return respond(error.statusCode || 500, { ok: false, error: error.message || 'Unable to prepare upload' });
  }
};
