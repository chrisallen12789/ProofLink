// netlify/functions/get-crew-jobs.js
// GET /.netlify/functions/get-crew-jobs
// Crew-member authenticated. Returns jobs assigned to the calling crew member.
// Query params:
//   ?date=YYYY-MM-DD  (defaults to today in tenant timezone)
//   ?status=scheduled,dispatched,in_progress  (comma-separated, defaults to active)
//   ?upcoming=true    (next 7 days, for schedule view)

'use strict';

const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');

function formatAddress(row = {}) {
  return [
    String(row.address_line1 || '').trim(),
    [String(row.city || '').trim(), String(row.state || '').trim(), String(row.zip || '').trim()].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
}

function buildDayPlan(jobList = []) {
  const ordered = [...jobList].sort((left, right) => (
    String(left?.scheduled_time || '').localeCompare(String(right?.scheduled_time || ''))
  ));
  return {
    total_stops: ordered.length,
    completed_stops: ordered.filter((job) => String(job?.status || '').trim().toLowerCase() === 'completed').length,
    remaining_stops: ordered.filter((job) => !['completed', 'cancelled'].includes(String(job?.status || '').trim().toLowerCase())).length,
    next_stop: ordered.find((job) => !['completed', 'cancelled'].includes(String(job?.status || '').trim().toLowerCase())) || null,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { user, tenantId } = ctx;
  const adminSb = getAdminClient();
  const params = event.queryStringParameters || {};

  // Resolve the operator_members record for this user
  const { data: member, error: memberErr } = await adminSb
    .from('operator_members')
    .select('id, display_name, email, role, role_title')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (memberErr) {
    console.error('[get-crew-jobs] member lookup error:', memberErr);
    return respond(500, { error: 'Failed to resolve crew member record' });
  }

  if (!member) {
    return respond(403, { error: 'No crew member record found for this user in this tenant' });
  }

  // Build job query
  let query = adminSb
    .from('jobs')
    .select(`
      *,
      customers ( name, phone, email, company_name ),
      orders ( title )
    `)
    .eq('tenant_id', tenantId);

  // Assignment filter: jobs may reference operator_members.id, operators.id, or user.id depending on age of data.
  query = query.or(`assigned_member_id.eq.${member.id},assigned_operator_id.eq.${member.id},assigned_operator_id.eq.${user.id}`);

  // Status filter
  if (params.status) {
    const statuses = params.status.split(',').map((s) => s.trim()).filter(Boolean);
    query = query.in('status', statuses);
  } else {
    query = query.not('status', 'in', '("cancelled","completed")');
  }

  // Date / upcoming filter
  if (params.upcoming === 'true') {
    const today = new Date().toISOString().slice(0, 10);
    const plus7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    query = query.gte('scheduled_date', today).lte('scheduled_date', plus7);
  } else if (params.date) {
    query = query.eq('scheduled_date', params.date);
  }

  query = query.order('scheduled_date', { ascending: true }).order('scheduled_time', { ascending: true });

  const { data: jobs, error: jobsErr } = await query;

  if (jobsErr) {
    console.error('[get-crew-jobs] jobs query error:', jobsErr);
    return respond(500, { error: 'Failed to fetch jobs' });
  }

  const jobList = jobs || [];

  // Fetch photos for all returned jobs
  let photos = [];
  let customerLocationsById = new Map();
  let recentJobsByKey = new Map();
  if (jobList.length > 0) {
    const jobIds = jobList.map((j) => j.id);
    const { data: photoData, error: photoErr } = await adminSb
      .from('job_photos')
      .select('id, job_id, url, photo_type, caption')
      .in('job_id', jobIds)
      .eq('tenant_id', tenantId);

    if (photoErr) {
      console.error('[get-crew-jobs] photo fetch error:', photoErr);
      // Non-fatal: continue without photos
    } else {
      photos = photoData || [];
    }

    const customerLocationIds = [...new Set(jobList.map((job) => job.customer_location_id).filter(Boolean))];
    if (customerLocationIds.length) {
      const { data: customerLocations, error: locationErr } = await adminSb
        .from('customer_locations')
        .select('id, customer_id, site_name, site_code, contact_name, contact_phone, contact_email, address_line1, city, state, zip, access_notes, notes')
        .in('id', customerLocationIds)
        .eq('tenant_id', tenantId);

      if (locationErr) {
        console.error('[get-crew-jobs] customer location fetch error:', locationErr);
      } else {
        customerLocationsById = new Map((customerLocations || []).map((row) => [row.id, row]));
      }
    }

    const customerIds = [...new Set(jobList.map((job) => job.customer_id).filter(Boolean))];
    if (customerIds.length) {
      const { data: recentJobs, error: recentJobsErr } = await adminSb
        .from('jobs')
        .select('id, customer_id, customer_location_id, title, status, scheduled_date, completed_at')
        .in('customer_id', customerIds)
        .eq('tenant_id', tenantId)
        .order('scheduled_date', { ascending: false })
        .limit(60);

      if (recentJobsErr) {
        console.error('[get-crew-jobs] recent jobs fetch error:', recentJobsErr);
      } else {
        (recentJobs || []).forEach((row) => {
          const key = row.customer_location_id || row.customer_id;
          if (!key) return;
          if (!recentJobsByKey.has(key)) recentJobsByKey.set(key, []);
          recentJobsByKey.get(key).push(row);
        });
      }
    }
  }

  // Attach photos to each job
  const photosByJob = {};
  for (const p of photos) {
    if (!photosByJob[p.job_id]) photosByJob[p.job_id] = [];
    photosByJob[p.job_id].push(p);
  }

  const jobsWithPhotos = jobList.map((job, index) => {
    const customerLocation = customerLocationsById.get(job.customer_location_id) || null;
    const recentKey = job.customer_location_id || job.customer_id;
    const recentJobs = (recentJobsByKey.get(recentKey) || [])
      .filter((row) => row.id !== job.id)
      .slice(0, 3);

    return {
      ...job,
      route_position: index + 1,
      route_total_stops: jobList.length,
      customer_location: customerLocation,
      service_address: job.service_address || formatAddress(customerLocation) || job.service_address,
      photos: photosByJob[job.id] || [],
      recent_jobs: recentJobs,
      site_packet: {
        site_name: customerLocation?.site_name || '',
        site_code: customerLocation?.site_code || '',
        service_address: formatAddress(customerLocation) || job.service_address || '',
        site_contact: [customerLocation?.contact_name, customerLocation?.contact_phone, customerLocation?.contact_email].filter(Boolean).join(' | '),
        access_notes: customerLocation?.access_notes || '',
        recent_photos: (photosByJob[job.id] || []).slice(0, 2),
      },
    };
  });

  return respond(200, {
    jobs: jobsWithPhotos,
    day_plan: buildDayPlan(jobsWithPhotos),
    member: {
      id: member.id,
      name: member.display_name,
      role: member.role,
      role_title: member.role_title,
    },
  });
};
