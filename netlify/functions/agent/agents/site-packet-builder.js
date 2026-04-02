'use strict';

const { buildRecordRef, createEvidenceBuilder } = require('../evidence');
const { getSitePacketContext } = require('../tools');

function firstCompletedHistoryJob(jobs = []) {
  return (Array.isArray(jobs) ? jobs : []).find((row) => {
    return ['completed', 'fulfilled', 'paid'].includes(String(row?.status || '').trim().toLowerCase());
  }) || null;
}

function calculateConfidence(context, blockers, findings) {
  const coverage = [
    context?.job ? 0.24 : 0,
    context?.customer ? 0.16 : 0,
    context?.customer_location ? 0.18 : 0,
    Array.isArray(context?.recent_site_jobs) ? 0.18 : 0,
    Array.isArray(context?.recent_site_photos) ? 0.14 : 0,
    context?.site_summary?.contact_name || context?.site_summary?.contact_phone ? 0.05 : 0,
    context?.site_summary?.access_notes ? 0.05 : 0,
  ].reduce((sum, value) => sum + value, 0);
  const penalty = Math.min(0.34, (blockers.length * 0.05) + ((context?.assumptions || []).length * 0.03));
  return {
    score: Number(Math.max(0.26, Math.min(0.95, coverage - penalty)).toFixed(2)),
    rationale: findings.length
      ? 'Confidence depends on whether the site packet can pull together address, access, contact, prior work, and proof history from real records.'
      : 'Confidence is strongest when a site location, crew access note, and prior work history are all attached to the job context.',
  };
}

function analyzeSitePacket(context = {}) {
  const evidence = createEvidenceBuilder();
  const findings = [];
  const blockers = [];
  const recommendedActions = [];
  const missingData = [];

  const job = context.job || {};
  const customer = context.customer || null;
  const location = context.customer_location || null;
  const recentJobs = Array.isArray(context.recent_site_jobs) ? context.recent_site_jobs : [];
  const recentPhotos = Array.isArray(context.recent_site_photos) ? context.recent_site_photos : [];
  const siteSummary = context.site_summary || {};
  const siteLabel = siteSummary.site_label || customer?.company_name || customer?.name || job.title || 'Site';
  const jobRef = buildRecordRef('job', job.id, job.title || 'Job');
  const customerRef = customer?.id ? buildRecordRef('customer', customer.id, customer.company_name || customer.name || 'Customer') : null;
  const siteRef = location?.id ? buildRecordRef('customer_location', location.id, location.site_name || siteLabel) : customerRef;

  const pushFinding = (config = {}) => findings.push({
    id: config.id,
    severity: config.severity,
    category: config.category,
    title: config.title,
    detail: config.detail,
    evidence_ids: config.evidence_ids || [],
    record_refs: (config.record_refs || []).filter(Boolean),
  });

  const pushBlocker = (config = {}) => blockers.push({
    id: config.id,
    title: config.title,
    detail: config.detail,
    evidence_ids: config.evidence_ids || [],
    record_refs: (config.record_refs || []).filter(Boolean),
  });

  const pushAction = (config = {}) => recommendedActions.push({
    id: config.id,
    title: config.title,
    detail: config.detail,
    priority: config.priority || 'medium',
    requires_operator_approval: true,
    suggested_ui_action: config.suggested_ui_action || '',
    evidence_ids: config.evidence_ids || [],
    record_refs: (config.record_refs || []).filter(Boolean),
  });

  const siteEvidenceId = evidence.add({
    record_type: location?.id ? 'customer_location' : 'job',
    record_id: location?.id || job.id,
    field: 'site_packet',
    label: 'Site packet coverage',
    value: [
      siteLabel,
      siteSummary.site_address || 'address missing',
      siteSummary.contact_name || siteSummary.contact_phone ? 'contact present' : 'contact missing',
      siteSummary.access_notes ? 'access note present' : 'access note missing',
      `${recentJobs.length} related job(s)`,
      `${recentPhotos.length} related photo(s)`,
    ].join(' | '),
  });

  if (!siteSummary.site_address) {
    pushFinding({
      id: 'site_packet_missing_address',
      severity: 'critical',
      category: 'site_context',
      title: 'The site packet is missing the real service address',
      detail: 'The crew packet still does not carry the actual service address, so navigation and proof review are weaker than they should be.',
      evidence_ids: [siteEvidenceId],
      record_refs: [jobRef, siteRef],
    });
    pushBlocker({
      id: 'site_packet_missing_address',
      title: 'Attach the service address before dispatch',
      detail: 'Add the real site address so the field team and office are working from the same location record.',
      evidence_ids: [siteEvidenceId],
      record_refs: [jobRef, siteRef],
    });
    missingData.push({
      id: 'site_packet_missing_address',
      label: 'Service address is missing',
      detail: 'The site packet should include a real service address or site location.',
      field: 'site_address',
      required_for: 'site_packet',
    });
  }

  if (!siteSummary.access_notes) {
    pushFinding({
      id: 'site_packet_missing_access',
      severity: 'warning',
      category: 'site_context',
      title: 'Access instructions are still light',
      detail: 'The packet does not yet include a clear access, entry, gate, or alarm note for the crew.',
      evidence_ids: [siteEvidenceId],
      record_refs: [jobRef, siteRef],
    });
    pushBlocker({
      id: 'site_packet_missing_access',
      title: 'Capture the site access note',
      detail: 'Add the entry, gate, alarm, parking, or tenant-access note before the crew learns it the hard way on arrival.',
      evidence_ids: [siteEvidenceId],
      record_refs: [jobRef, siteRef],
    });
    missingData.push({
      id: 'site_packet_missing_access',
      label: 'Access notes are missing',
      detail: 'The crew packet should include access instructions when the site depends on them.',
      field: 'access_notes',
      required_for: 'site_packet',
    });
  }

  if (!siteSummary.contact_name && !siteSummary.contact_phone && !siteSummary.contact_email) {
    pushFinding({
      id: 'site_packet_missing_contact',
      severity: 'warning',
      category: 'site_context',
      title: 'No on-site contact path is attached',
      detail: 'The packet still does not show who the crew should call, text, or meet on arrival.',
      evidence_ids: [siteEvidenceId],
      record_refs: [jobRef, siteRef, customerRef],
    });
    missingData.push({
      id: 'site_packet_missing_contact',
      label: 'On-site contact is missing',
      detail: 'The site packet should show a contact name, phone, or email for arrival issues.',
      field: 'contact_name|contact_phone|contact_email',
      required_for: 'site_packet',
    });
  }

  if (!recentJobs.length) {
    pushFinding({
      id: 'site_packet_light_history',
      severity: 'info',
      category: 'history',
      title: 'No prior site work history was found',
      detail: 'This packet does not yet have prior job history to brief the crew with, so the current visit will establish the baseline.',
      evidence_ids: [siteEvidenceId],
      record_refs: [jobRef, siteRef],
    });
  } else {
    const latestHistory = firstCompletedHistoryJob(recentJobs) || recentJobs[0];
    const historyEvidenceId = evidence.add({
      record_type: 'job',
      record_id: latestHistory.id,
      field: 'notes',
      label: 'Latest related site history',
      value: `${latestHistory.title || 'Related job'} | ${latestHistory.status || 'unknown'} | ${latestHistory.notes || latestHistory.service_address || 'No site note stored'}`,
    });
    pushFinding({
      id: 'site_packet_recent_history',
      severity: 'info',
      category: 'history',
      title: 'Related site history is available for the crew',
      detail: latestHistory.notes
        ? `The latest related site record already carries context the crew should see before arrival: ${latestHistory.notes}`
        : 'The packet can point the crew to recent site history, even if the stored notes are still light.',
      evidence_ids: [historyEvidenceId],
      record_refs: [jobRef, buildRecordRef('job', latestHistory.id, latestHistory.title || 'Related job')],
    });
  }

  if (!recentPhotos.length) {
    pushFinding({
      id: 'site_packet_missing_proof_history',
      severity: 'info',
      category: 'history',
      title: 'No prior proof photos were found for this site packet',
      detail: 'The crew packet does not yet have prior proof to review. This visit may need to establish that baseline.',
      evidence_ids: [siteEvidenceId],
      record_refs: [jobRef, siteRef],
    });
  }

  pushAction({
    id: 'site_packet_review_before_dispatch',
    title: 'Use the site packet before the crew rolls',
    detail: 'Review the access, contact, site notes, and latest related work while the dispatch plan is still easy to tighten.',
    priority: blockers.length ? 'high' : 'medium',
    suggested_ui_action: 'open_job',
    evidence_ids: [siteEvidenceId],
    record_refs: [jobRef, siteRef],
  });

  if (!siteSummary.access_notes || !siteSummary.contact_name && !siteSummary.contact_phone && !siteSummary.contact_email) {
    pushAction({
      id: 'site_packet_fill_missing_arrival_context',
      title: 'Fill the missing arrival details',
      detail: 'Add the access instructions and on-site contact path so the crew does not arrive with avoidable uncertainty.',
      priority: 'high',
      suggested_ui_action: 'open_customer',
      evidence_ids: [siteEvidenceId],
      record_refs: [siteRef, customerRef, jobRef],
    });
  }

  if (recentJobs.length || recentPhotos.length) {
    pushAction({
      id: 'site_packet_brief_from_history',
      title: 'Brief the crew from prior site history',
      detail: 'Use the related jobs and proof history to remind the crew what changed, what repeats, and what should not be rediscovered on site.',
      priority: 'medium',
      suggested_ui_action: 'open_customer',
      evidence_ids: evidence.list().map((item) => item.id).slice(0, 3),
      record_refs: [jobRef, siteRef],
    });
  }

  const confidence = calculateConfidence(context, blockers, findings);
  const summary = blockers.length
    ? `The site packet for ${siteLabel} still needs arrival-critical details before it will really help the crew.`
    : recentJobs.length || recentPhotos.length
      ? `The site packet for ${siteLabel} is grounded in prior work and proof, so the crew can arrive with stronger context.`
      : `The site packet for ${siteLabel} is light but usable. This visit will help establish the richer site history going forward.`;

  return {
    agent_key: 'site_packet_builder',
    agent_label: 'Site Packet Builder',
    summary,
    summary_status: blockers.length ? 'blocked' : (recentJobs.length || recentPhotos.length ? 'ready' : 'review_needed'),
    findings,
    blockers,
    evidence: evidence.list(),
    assumptions: context.assumptions || [],
    missing_data: missingData,
    confidence,
    recommended_actions: recommendedActions,
    data_used: context.data_used || [],
    scope: {
      tenant_id: context.tenant_id || '',
      job_id: job.id || '',
      customer_id: customer?.id || '',
    },
    generated_at: new Date().toISOString(),
  };
}

async function runSitePacketBuilder({ supabase, tenantId, input }) {
  const jobId = String(input?.job_id || input?.jobId || '').trim();
  if (!jobId) {
    const err = new Error('job_id is required');
    err.statusCode = 400;
    throw err;
  }

  const context = await getSitePacketContext(supabase, tenantId, jobId);
  return {
    report: analyzeSitePacket(context),
    tools_used: ['get_site_packet_context'],
    context_summary: {
      job_id: jobId,
      recent_site_jobs: Array.isArray(context.recent_site_jobs) ? context.recent_site_jobs.length : 0,
      recent_site_photos: Array.isArray(context.recent_site_photos) ? context.recent_site_photos.length : 0,
      has_customer_location: !!context.customer_location,
    },
  };
}

module.exports = {
  analyzeSitePacket,
  runSitePacketBuilder,
};
