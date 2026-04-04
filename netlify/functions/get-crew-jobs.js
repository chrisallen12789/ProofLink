// netlify/functions/get-crew-jobs.js
// GET /.netlify/functions/get-crew-jobs
// Crew-member authenticated. Returns jobs assigned to the calling crew member.
// Query params:
//   ?date=YYYY-MM-DD  (defaults to today in tenant timezone)
//   ?status=scheduled,dispatched,in_progress  (comma-separated, defaults to active)
//   ?upcoming=true    (next 7 days, for schedule view)

'use strict';

const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');
const { extractHydrovacCompletionHandoff } = require('./lib/hydrovac-closeout');

function compactText(value, max = 240) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.slice(0, max);
}

function firstFilledText(...values) {
  for (const value of values) {
    const text = compactText(value);
    if (text) return text;
  }
  return '';
}

function buildAddress(row = {}) {
  const line = compactText(row?.address_line1 || row?.service_address || '');
  const locality = [row?.city, row?.state, row?.zip].map((value) => compactText(value, 80)).filter(Boolean).join(' ').trim();
  return [line, locality].filter(Boolean).join(', ');
}

function summarizeRecentWork(row = {}) {
  return {
    id: compactText(row?.id, 80),
    title: compactText(row?.title || row?.customer_name || 'Job', 180),
    status: compactText(row?.status, 80),
    scheduled_date: compactText(row?.scheduled_date, 40),
    completed_at: compactText(row?.completed_at, 60),
    notes: compactText(row?.notes || row?.completion_note || row?.crew_notes || '', 220),
  };
}

function memberRoleTitle(role = '') {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'owner') return 'Owner';
  if (normalized === 'manager') return 'Manager';
  if (normalized === 'admin') return 'Admin';
  if (normalized === 'viewer') return 'Viewer';
  return 'Crew Member';
}

function buildCrewSitePacket(job, location, recentJobs = [], currentPhotos = []) {
  const customer = job?.customers || {};
  const order = job?.orders || {};
  return {
    site_label: firstFilledText(location?.site_name, customer?.company_name, customer?.name, order?.title, job?.title),
    site_address: buildAddress(location) || firstFilledText(job?.service_address, job?.address),
    access_notes: firstFilledText(location?.access_notes, customer?.access_notes, customer?.entry_notes, customer?.alarm_notes, customer?.gate_notes),
    site_notes: firstFilledText(location?.site_notes, customer?.service_notes, customer?.scope_notes, order?.notes, job?.notes),
    contact_name: firstFilledText(location?.contact_name, customer?.name),
    contact_phone: firstFilledText(location?.contact_phone, customer?.phone, order?.customer_phone),
    contact_email: firstFilledText(location?.contact_email, customer?.email, order?.customer_email),
    recent_work: recentJobs.slice(0, 3).map((row) => summarizeRecentWork(row)),
    current_photo_count: Array.isArray(currentPhotos) ? currentPhotos.length : 0,
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
    .select('operator_id, user_id, role, role_title, operators!operator_id(id, name, email, role)')
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
      customers ( * ),
      orders!jobs_order_id_fkey ( * )
    `)
    .eq('tenant_id', tenantId);

  // Assignment filter: jobs may reference operator_members.id, operators.id, or user.id depending on age of data.
  const assignmentKeys = [
    member.operator_id,
    user.id,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  query = query.or(assignmentKeys.map((value) => `assigned_member_id.eq.${value},assigned_operator_id.eq.${value}`).join(','));

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
  const locationIds = [...new Set(jobList.map((job) => String(job?.customer_location_id || '').trim()).filter(Boolean))];
  const customerIds = [...new Set(jobList.map((job) => String(job?.customer_id || '').trim()).filter(Boolean))];

  // Fetch photos for all returned jobs
  let photos = [];
  let manifests = [];
  let locateTickets = [];
  let permits = [];
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

    const { data: manifestData, error: manifestErr } = await adminSb
      .from('waste_manifests')
      .select('id, job_id, manifest_number, status, metadata, quantity_actual, quantity_estimated')
      .eq('tenant_id', tenantId)
      .in('job_id', jobIds);
    if (manifestErr) {
      console.error('[get-crew-jobs] manifest fetch error:', manifestErr);
    } else {
      manifests = manifestData || [];
    }

    const { data: locateData, error: locateErr } = await adminSb
      .from('utility_locate_tickets')
      .select('id, job_id, ticket_number, status, valid_until, extended_until, verified_on_site')
      .eq('tenant_id', tenantId)
      .in('job_id', jobIds);
    if (locateErr) {
      console.error('[get-crew-jobs] locate fetch error:', locateErr);
    } else {
      locateTickets = locateData || [];
    }

    const { data: permitData, error: permitErr } = await adminSb
      .from('confined_space_permits')
      .select('id, job_id, permit_number, status, permit_valid_until')
      .eq('tenant_id', tenantId)
      .in('job_id', jobIds);
    if (permitErr) {
      console.error('[get-crew-jobs] permit fetch error:', permitErr);
    } else {
      permits = permitData || [];
    }
  }

  // Attach photos to each job
  const photosByJob = {};
  for (const p of photos) {
    if (!photosByJob[p.job_id]) photosByJob[p.job_id] = [];
    photosByJob[p.job_id].push(p);
  }
  const manifestsByJob = {};
  for (const row of manifests) {
    if (!manifestsByJob[row.job_id]) manifestsByJob[row.job_id] = [];
    manifestsByJob[row.job_id].push(row);
  }
  const locatesByJob = {};
  for (const row of locateTickets) {
    if (!locatesByJob[row.job_id]) locatesByJob[row.job_id] = [];
    locatesByJob[row.job_id].push(row);
  }
  const permitsByJob = {};
  for (const row of permits) {
    if (!permitsByJob[row.job_id]) permitsByJob[row.job_id] = [];
    permitsByJob[row.job_id].push(row);
  }

  let customerLocations = [];
  if (locationIds.length) {
    const { data, error } = await adminSb
      .from('customer_locations')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('id', locationIds);
    if (error) {
      console.error('[get-crew-jobs] customer location fetch error:', error);
    } else {
      customerLocations = data || [];
    }
  }
  const customerLocationById = new Map(customerLocations.map((row) => [row.id, row]));

  let relatedJobs = [];
  if (customerIds.length) {
    const { data, error } = await adminSb
      .from('jobs')
      .select('id, title, status, scheduled_date, completed_at, updated_at, service_address, notes, completion_note, crew_notes, customer_id')
      .eq('tenant_id', tenantId)
      .in('customer_id', customerIds)
      .order('updated_at', { ascending: false })
      .limit(120);
    if (error) {
      console.error('[get-crew-jobs] related customer-job fetch error:', error);
    } else {
      relatedJobs = data || [];
    }
  }

  if (locationIds.length) {
    const { data, error } = await adminSb
      .from('jobs')
      .select('id, title, status, scheduled_date, completed_at, updated_at, service_address, notes, completion_note, crew_notes, customer_id')
      .eq('tenant_id', tenantId)
      .in('customer_location_id', locationIds)
      .order('updated_at', { ascending: false })
      .limit(120);
    if (error) {
      console.error('[get-crew-jobs] related site-job fetch error:', error);
    } else {
      const seen = new Set(relatedJobs.map((row) => row.id));
      (data || []).forEach((row) => {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          relatedJobs.push(row);
        }
      });
    }
  }

  const jobsWithPhotos = jobList.map((j) => ({
    ...j,
    photos: photosByJob[j.id] || [],
    waste_manifests: manifestsByJob[j.id] || [],
    locate_tickets: locatesByJob[j.id] || [],
    confined_space_permits: permitsByJob[j.id] || [],
    customer_location: customerLocationById.get(j.customer_location_id) || null,
  })).map((job) => {
    const recentJobs = relatedJobs.filter((row) => {
      if (!row || row.id === job.id) return false;
      if (job.customer_location_id && row.customer_location_id) {
        return String(row.customer_location_id) === String(job.customer_location_id);
      }
      return String(row.customer_id || '') === String(job.customer_id || '');
    }).slice(0, 4);

    return {
      ...job,
      completion_handoff: extractHydrovacCompletionHandoff(job),
      site_packet: buildCrewSitePacket(
        job,
        job.customer_location,
        recentJobs,
        photosByJob[job.id] || []
      ),
    };
  });

  return respond(200, {
    jobs: jobsWithPhotos,
    member: {
      id: member.operator_id || member.operators?.id || null,
      name: member.operators?.name || member.operators?.email || user.email || 'Crew Member',
      role: member.role,
      role_title: member.role_title || memberRoleTitle(member.role),
    },
  });
};
