// GET /.netlify/functions/get-job-detail?id=<uuid>
// Crew or operator authenticated. Returns full job detail including photos.
// Requires operator context (crew members are registered as operator_members).
// Returns { job: { ...jobColumns, photos: [...jobPhotos] } }

'use strict';

const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { tenantId } = ctx;
  const supabase = getAdminClient();

  const id = (event.queryStringParameters || {}).id || '';
  if (!id) return respond(400, { error: 'Missing required query param: id' });

  // Fetch the job record
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (jobError) {
    console.error('[get-job-detail] job fetch error', jobError);
    return respond(500, { error: 'Failed to fetch job' });
  }

  if (!job) return respond(404, { error: 'Job not found' });

  // Enforce tenant isolation
  if (job.tenant_id !== tenantId) {
    return respond(403, { error: 'Forbidden: job does not belong to your tenant' });
  }

  // Fetch associated photos
  const { data: photos, error: photosError } = await supabase
    .from('job_photos')
    .select('*')
    .eq('job_id', id)
    .order('created_at', { ascending: true });

  if (photosError) {
    console.error('[get-job-detail] photos fetch error', photosError);
    return respond(500, { error: 'Failed to fetch job photos' });
  }

  return respond(200, { job: { ...job, photos: photos || [] } });
};
