const { requireOperatorContext, respond } = require('./utils/auth');
const { BUCKET, parseReceipt, incrementStorageUsage, readUploadedObjectBytes } = require('./lib/tenant-storage');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, { ok: true });
  if (event.httpMethod !== 'POST') return respond(405, { ok: false, error: 'Method not allowed' });

  try {
    const ctx = await requireOperatorContext(event);
    const body = JSON.parse(event.body || '{}');
    const receipt = parseReceipt(body.receipt);

    if (ctx.role !== 'admin' && ctx.role !== 'platform_admin' && ctx.tenantId && ctx.tenantId !== receipt.tenantId) {
      return respond(403, { ok: false, error: 'Forbidden: tenant mismatch' });
    }

    const storageObject = await readUploadedObjectBytes(receipt.objectPath);
    const actualBytes = Number(storageObject.size || 0);

    if (!actualBytes || actualBytes <= 0) {
      return respond(409, { ok: false, error: 'Uploaded file is empty or not yet committed in storage' });
    }

    await incrementStorageUsage({ tenantId: receipt.tenantId, bytes: actualBytes });

    return respond(200, {
      ok: true,
      bucket: BUCKET,
      objectPath: receipt.objectPath,
      bytes: actualBytes,
      slot: receipt.slot,
      folder: receipt.folder,
      committed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('commit-tenant-asset error:', error);
    return respond(error.statusCode || 500, { ok: false, error: error.message || 'Unable to commit upload' });
  }
};
