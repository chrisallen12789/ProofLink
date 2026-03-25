'use strict';

const { respond } = require('./utils/auth');
const {
  asArray,
  clean,
  parseJsonBody,
  requireHydrovacOperatorContext,
  toIsoOrNull,
} = require('./utils/hydrovac');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  let ctx;
  try {
    ctx = await requireHydrovacOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { tenantId, adminSb, operatorId, user } = ctx;
  const params = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (clean(params.job_id)) {
      const { data, error } = await adminSb
        .from('utility_locate_tickets')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('job_id', clean(params.job_id))
        .order('valid_until', { ascending: true });

      if (error) return respond(500, { error: error.message });
      return respond(200, { tickets: data || [] });
    }

    if (clean(params.status)) {
      let query = adminSb
        .from('utility_locate_tickets')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', clean(params.status));

      const days = parseInt(params.days_until_expiry, 10);
      if (Number.isFinite(days) && days >= 0) {
        const until = new Date(Date.now() + (days * 24 * 60 * 60 * 1000)).toISOString();
        query = query.lte('valid_until', until);
      }

      const { data, error } = await query.order('valid_until', { ascending: true });
      if (error) return respond(500, { error: error.message });
      return respond(200, { tickets: data || [] });
    }

    return respond(400, { error: 'job_id or status is required' });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = parseJsonBody(event);
    } catch {
      return respond(400, { error: 'Invalid JSON body' });
    }

    const ticketNumber = clean(body.ticket_number);
    const workSiteAddress = clean(body.work_site_address);
    const validUntil = toIsoOrNull(body.valid_until);

    if (!ticketNumber) return respond(400, { error: 'ticket_number is required' });
    if (!workSiteAddress) return respond(400, { error: 'work_site_address is required' });
    if (validUntil && new Date(validUntil).getTime() < Date.now()) {
      return respond(400, { error: 'Ticket is already expired' });
    }

    const { data, error } = await adminSb
      .from('utility_locate_tickets')
      .insert({
        tenant_id: tenantId,
        job_id: clean(body.job_id) || null,
        order_id: clean(body.order_id) || null,
        customer_id: clean(body.customer_id) || null,
        ticket_number: ticketNumber,
        ticket_type: clean(body.ticket_type || 'standard') || 'standard',
        one_call_center: clean(body.one_call_center) || null,
        state_province: clean(body.state_province) || null,
        county: clean(body.county) || null,
        work_site_address: workSiteAddress,
        work_site_city: clean(body.work_site_city) || null,
        excavation_type: clean(body.excavation_type) || null,
        depth_of_excavation_ft: body.depth_of_excavation_ft != null ? Number(body.depth_of_excavation_ft) : null,
        work_area_description: clean(body.work_area_description) || null,
        status: clean(body.status || 'requested') || 'requested',
        requested_at: toIsoOrNull(body.requested_at) || new Date().toISOString(),
        valid_from: toIsoOrNull(body.valid_from),
        valid_until: validUntil,
        extended_until: toIsoOrNull(body.extended_until),
        extension_ticket_number: clean(body.extension_ticket_number) || null,
        all_clear: body.all_clear === true ? true : body.all_clear === false ? false : null,
        utilities_notified: asArray(body.utilities_notified),
        conflict_utilities: asArray(body.conflict_utilities),
        locate_notes: clean(body.locate_notes || body.notes) || null,
        damage_occurred: body.damage_occurred === true,
        damage_notes: clean(body.damage_notes) || null,
        created_by_member_id: clean(body.created_by_member_id) || operatorId || null,
      })
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });

    if (data?.job_id) {
      try {
        const { data: tickets } = await adminSb
          .from('utility_locate_tickets')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('job_id', data.job_id)
          .neq('status', 'cancelled');

        await adminSb
          .from('jobs')
          .update({ locate_ticket_ids: (tickets || []).map((row) => row.id) })
          .eq('tenant_id', tenantId)
          .eq('id', data.job_id);
      } catch (syncError) {
        console.warn('[manage-locate-tickets] job sync failed:', syncError.message || syncError);
      }
    }

    return respond(201, { ok: true, ticket: data });
  }

  if (event.httpMethod === 'PATCH') {
    let body;
    try {
      body = parseJsonBody(event);
    } catch {
      return respond(400, { error: 'Invalid JSON body' });
    }

    const id = clean(body.id);
    if (!id) return respond(400, { error: 'id is required' });

    const { data: member } = await adminSb
      .from('operator_members')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .maybeSingle();

    const patch = {};
    const allowedFields = [
      'status', 'all_clear', 'utilities_notified', 'conflict_utilities',
      'verified_on_site', 'extension_ticket_number', 'extended_until',
      'damage_occurred', 'damage_notes', 'locate_notes', 'requested_at',
      'valid_from', 'valid_until',
    ];
    for (const field of allowedFields) {
      if (body[field] !== undefined) patch[field] = body[field];
    }

    if (patch.extended_until !== undefined) patch.extended_until = toIsoOrNull(patch.extended_until);
    if (patch.valid_from !== undefined) patch.valid_from = toIsoOrNull(patch.valid_from);
    if (patch.valid_until !== undefined) patch.valid_until = toIsoOrNull(patch.valid_until);
    if (patch.requested_at !== undefined) patch.requested_at = toIsoOrNull(patch.requested_at);
    if (patch.utilities_notified !== undefined) patch.utilities_notified = asArray(patch.utilities_notified);
    if (patch.conflict_utilities !== undefined) patch.conflict_utilities = asArray(patch.conflict_utilities);

    if (patch.verified_on_site === true) {
      patch.verified_at = new Date().toISOString();
      patch.verified_by_member_id = member?.id || operatorId || null;
    }

    const { data, error } = await adminSb
      .from('utility_locate_tickets')
      .update(patch)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    if (!data) return respond(404, { error: 'Ticket not found' });

    if (data.job_id) {
      try {
        const { data: tickets } = await adminSb
          .from('utility_locate_tickets')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('job_id', data.job_id)
          .neq('status', 'cancelled');

        await adminSb
          .from('jobs')
          .update({ locate_ticket_ids: (tickets || []).map((row) => row.id) })
          .eq('tenant_id', tenantId)
          .eq('id', data.job_id);
      } catch (syncError) {
        console.warn('[manage-locate-tickets] job sync failed:', syncError.message || syncError);
      }
    }

    return respond(200, { ok: true, ticket: data });
  }

  return respond(405, { error: 'Method not allowed' });
};
