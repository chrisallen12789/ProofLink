// netlify/functions/upload-job-photo.js
// POST /.netlify/functions/upload-job-photo
// Crew-member authenticated. Accepts base64-encoded image, uploads to Supabase Storage,
// inserts job_photos record.
// Body: { job_id, photo_base64, mime_type, photo_type, caption? }
// photo_type: 'before' | 'after' | 'during' | 'blocker' | 'other'
// Returns: { photo: { id, url, photo_type, caption } }

'use strict';

const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');

const VALID_PHOTO_TYPES = new Set(['before', 'after', 'during', 'blocker', 'other']);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { user, tenantId } = ctx;
  const adminSb = getAdminClient();

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON body' }); }

  const { job_id, photo_base64, mime_type, photo_type, caption } = body;

  if (!job_id) return respond(400, { error: 'job_id is required' });
  if (!photo_base64) return respond(400, { error: 'photo_base64 is required' });
  if (!photo_type) return respond(400, { error: 'photo_type is required' });

  if (!VALID_PHOTO_TYPES.has(photo_type)) {
    return respond(400, { error: `Invalid photo_type. Must be one of: ${[...VALID_PHOTO_TYPES].join(', ')}` });
  }

  // Verify job belongs to this tenant
  const { data: job, error: jobErr } = await adminSb
    .from('jobs')
    .select('id, tenant_id')
    .eq('id', job_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (jobErr) {
    console.error('[upload-job-photo] job fetch error:', jobErr);
    return respond(500, { error: 'Failed to verify job' });
  }

  if (!job) return respond(404, { error: 'Job not found or does not belong to your tenant' });

  // Decode base64 to buffer
  let imageBuffer;
  try {
    imageBuffer = Buffer.from(photo_base64, 'base64');
  } catch (decodeErr) {
    console.error('[upload-job-photo] base64 decode error:', decodeErr);
    return respond(400, { error: 'Invalid base64 image data' });
  }

  // Build storage path
  const ext = (mime_type || 'image/jpeg').includes('png') ? 'png' : 'jpg';
  const storagePath = `job-photos/${tenantId}/${job_id}/${Date.now()}.${ext}`;
  const contentType = mime_type || 'image/jpeg';

  // Upload to Supabase Storage
  const { error: uploadErr } = await adminSb.storage
    .from('job-photos')
    .upload(storagePath, imageBuffer, { contentType, upsert: false });

  if (uploadErr) {
    console.error('[upload-job-photo] storage upload error:', uploadErr);
    return respond(500, { error: 'Failed to upload photo to storage' });
  }

  // Get public URL
  const { data: urlData } = adminSb.storage
    .from('job-photos')
    .getPublicUrl(storagePath);

  const publicUrl = urlData?.publicUrl || '';

  // Insert record into job_photos table
  const { data: photo, error: insertErr } = await adminSb
    .from('job_photos')
    .insert({
      tenant_id   : tenantId,
      job_id,
      uploaded_by : user.id,
      url         : publicUrl,
      storage_path: storagePath,
      photo_type,
      caption     : caption || null,
    })
    .select('id, url, photo_type, caption')
    .maybeSingle();

  if (insertErr) {
    console.error('[upload-job-photo] insert error:', insertErr);
    return respond(500, { error: 'Photo uploaded but failed to save record' });
  }

  return respond(200, { photo });
};
