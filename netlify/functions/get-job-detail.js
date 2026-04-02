// GET /.netlify/functions/get-job-detail?id=<uuid>
// Crew or operator authenticated. Returns full job detail including photos.
// Requires operator context (crew members are registered as operator_members).
// Returns { job: { ...jobColumns, photos: [...jobPhotos] } }

'use strict';

const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');

function formatAddress(row = {}) {
  return [
    String(row.address_line1 || '').trim(),
    [String(row.city || '').trim(), String(row.state || '').trim(), String(row.zip || '').trim()].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
}

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

  let customerLocation = null;
  if (job.customer_location_id) {
    const { data } = await supabase
      .from('customer_locations')
      .select('id, customer_id, site_name, site_code, contact_name, contact_phone, contact_email, address_line1, city, state, zip, access_notes, notes')
      .eq('tenant_id', tenantId)
      .eq('id', job.customer_location_id)
      .maybeSingle();
    customerLocation = data || null;
  }

  let recentJobs = [];
  if (job.customer_id) {
    const { data } = await supabase
      .from('jobs')
      .select('id, customer_id, customer_location_id, title, status, scheduled_date, completed_at')
      .eq('tenant_id', tenantId)
      .eq('customer_id', job.customer_id)
      .neq('id', id)
      .order('scheduled_date', { ascending: false })
      .limit(5);
    recentJobs = data || [];
  }

  return respond(200, {
    job: {
      ...job,
      customer_location: customerLocation,
      service_address: job.service_address || formatAddress(customerLocation) || job.service_address,
      recent_jobs: recentJobs,
      photos: photos || [],
      site_packet: {
        site_name: customerLocation?.site_name || '',
        site_code: customerLocation?.site_code || '',
        service_address: formatAddress(customerLocation) || job.service_address || '',
        site_contact: [customerLocation?.contact_name, customerLocation?.contact_phone, customerLocation?.contact_email].filter(Boolean).join(' | '),
        access_notes: customerLocation?.access_notes || '',
        recent_photos: (photos || []).slice(0, 3),
      },
    },
  });
};
