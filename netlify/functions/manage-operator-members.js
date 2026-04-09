// netlify/functions/manage-operator-members.js
// Operator-authenticated — CRUD for operator_members (team management).
// GET /                                          → list all members for tenant
// POST { email, name, role }                     → invite user + create member row
// PATCH { id, role, hourly_rate_cents, ... }     → update member fields
// DELETE /?id=<uuid>                             → remove member row (does NOT delete auth user)

'use strict';

const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');

const ALLOWED_ROLES = ['owner', 'admin', 'member', 'viewer'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { tenantId } = ctx;
  const adminSb = getAdminClient();
  const params = event.queryStringParameters || {};

  // ── GET ───────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { data, error } = await adminSb
      .from('operator_members')
      .select('id, user_id, role, name, hourly_rate_cents, weekly_capacity_hours, worker_label, driver_label, compensation_type, is_union_member, union_local_number, union_classification_label, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) return respond(500, { error: error.message });
    return respond(200, { members: data || [] });
  }

  // ── POST (invite) ─────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    const { email, name, role } = body;
    if (!email) return respond(400, { error: 'email is required' });

    const effectiveRole = role && ALLOWED_ROLES.includes(role) ? role : 'member';

    const { data: inviteData, error: inviteError } = await adminSb.auth.admin.inviteUserByEmail(email);
    if (inviteError) return respond(500, { error: inviteError.message });

    const invitedUser = inviteData?.user;
    if (!invitedUser?.id) return respond(500, { error: 'Failed to retrieve invited user id' });

    const { data, error } = await adminSb
      .from('operator_members')
      .insert({
        tenant_id: tenantId,
        user_id  : invitedUser.id,
        role     : effectiveRole,
        name     : name || null,
      })
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    if (!data) return respond(500, { error: 'Failed to create member: no record returned' });
    return respond(201, { member: data });
  }

  // ── PATCH ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    const { id, ...fields } = body;
    if (!id) return respond(400, { error: 'id is required' });

    const ALLOWED = [
      'role',
      'hourly_rate_cents',
      'weekly_capacity_hours',
      'name',
      'worker_label',
      'driver_label',
      'compensation_type',
      'is_union_member',
      'union_local_number',
      'union_classification_label',
    ];
    const patch = Object.fromEntries(
      Object.entries(fields).filter(([k]) => ALLOWED.includes(k))
    );

    if (patch.role !== undefined && !ALLOWED_ROLES.includes(patch.role)) {
      return respond(400, { error: `role must be one of: ${ALLOWED_ROLES.join(', ')}` });
    }

    if (patch.compensation_type !== undefined) {
      const normalizedType = String(patch.compensation_type || '').trim().toLowerCase();
      if (!['hourly', 'salary', 'day_rate', 'job_rate', 'commission', 'blended'].includes(normalizedType)) {
        return respond(400, { error: 'compensation_type must be hourly, salary, day_rate, job_rate, commission, or blended' });
      }
      patch.compensation_type = normalizedType;
    }

    if (!Object.keys(patch).length) return respond(400, { error: 'No valid fields to update' });
    patch.updated_at = new Date().toISOString();

    const { data, error } = await adminSb
      .from('operator_members')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    if (!data) return respond(404, { error: 'Member not found or access denied' });
    return respond(200, { member: data });
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const id = params.id;
    if (!id) return respond(400, { error: 'id is required' });

    const { error } = await adminSb
      .from('operator_members')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) return respond(500, { error: error.message });
    return respond(200, { ok: true });
  }

  return respond(405, { error: 'Method not allowed' });
};
