'use strict';

const { respond } = require('./utils/auth');
const { clean, parseJsonBody, requireHydrovacOperatorContext } = require('./utils/hydrovac');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  let ctx;
  try {
    ctx = await requireHydrovacOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { tenantId, adminSb } = ctx;
  const params = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    let query = adminSb
      .from('compliance_alerts')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('resolved', { ascending: true })
      .order('created_at', { ascending: false });

    if (clean(params.reference_type)) query = query.eq('reference_type', clean(params.reference_type));
    if (clean(params.reference_id)) query = query.eq('reference_id', clean(params.reference_id));
    if (clean(params.alert_type)) query = query.eq('alert_type', clean(params.alert_type));
    if (clean(params.resolved)) query = query.eq('resolved', clean(params.resolved) === 'true');
    else query = query.eq('resolved', false);

    const limit = Math.min(250, Math.max(1, parseInt(params.limit, 10) || 100));
    query = query.limit(limit);

    const { data, error } = await query;
    if (error) return respond(500, { error: error.message });
    return respond(200, { alerts: data || [] });
  }

  if (event.httpMethod === 'PATCH') {
    let body;
    try {
      body = parseJsonBody(event);
    } catch {
      return respond(400, { error: 'Invalid JSON body' });
    }

    const id = clean(body.id);
    const resolved = body.resolved !== false;
    if (!id) return respond(400, { error: 'id is required' });

    const { data, error } = await adminSb
      .from('compliance_alerts')
      .update({
        resolved,
        resolved_at: resolved ? new Date().toISOString() : null,
      })
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    return respond(200, { ok: true, alert: data });
  }

  return respond(405, { error: 'Method not allowed' });
};
