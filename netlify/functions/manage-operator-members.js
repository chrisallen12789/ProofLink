// netlify/functions/manage-operator-members.js
// Operator-authenticated CRUD for operator_members.

'use strict';

const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');

const UI_ROLES = ['owner', 'admin', 'member', 'viewer'];
const STORAGE_ROLE_BY_UI_ROLE = {
  owner: 'owner',
  admin: 'manager',
  manager: 'manager',
  member: 'staff',
  staff: 'staff',
  viewer: 'staff',
};

function isMissingColumnError(error) {
  return String(error?.code || '').trim() === '42703';
}

function uiRoleForStorageRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'owner') return 'owner';
  if (normalized === 'manager' || normalized === 'admin') return 'admin';
  if (normalized === 'viewer') return 'viewer';
  return 'member';
}

function storageRoleForUiRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return STORAGE_ROLE_BY_UI_ROLE[normalized] || 'staff';
}

function normalizeCompensationType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!['hourly', 'salary', 'day_rate', 'job_rate', 'commission', 'blended'].includes(normalized)) {
    return '';
  }
  return normalized;
}

function normalizeMemberRow(row = {}) {
  return {
    ...row,
    id: row.id || row.operator_id || row.user_id || null,
    operator_id: row.operator_id || row.id || null,
    role: uiRoleForStorageRole(row.role),
  };
}

async function listMembers(adminSb, tenantId) {
  const richSelect = [
    'id',
    'operator_id',
    'user_id',
    'role',
    'name',
    'hourly_rate_cents',
    'weekly_capacity_hours',
    'worker_label',
    'driver_label',
    'compensation_type',
    'is_union_member',
    'union_local_number',
    'union_classification_label',
    'created_at',
  ].join(', ');
  const legacySelect = [
    'operator_id',
    'user_id',
    'role',
    'hourly_rate_cents',
    'weekly_capacity_hours',
    'created_at',
  ].join(', ');
  const bareLegacySelect = [
    'operator_id',
    'user_id',
    'role',
    'created_at',
  ].join(', ');

  let result = await adminSb
    .from('operator_members')
    .select(richSelect)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (result.error && isMissingColumnError(result.error)) {
    result = await adminSb
      .from('operator_members')
      .select(legacySelect)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });
  }

  if (result.error && isMissingColumnError(result.error)) {
    result = await adminSb
      .from('operator_members')
      .select(bareLegacySelect)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });
  }

  return result;
}

async function updateMember(adminSb, tenantId, memberId, patch) {
  let result = await adminSb
    .from('operator_members')
    .update(patch)
    .eq('id', memberId)
    .eq('tenant_id', tenantId)
    .select()
    .maybeSingle();

  if (result.error && isMissingColumnError(result.error)) {
    const legacyPatch = { ...patch };
    delete legacyPatch.worker_label;
    delete legacyPatch.driver_label;
    delete legacyPatch.compensation_type;
    delete legacyPatch.is_union_member;
    delete legacyPatch.union_local_number;
    delete legacyPatch.union_classification_label;

    result = await adminSb
      .from('operator_members')
      .update(legacyPatch)
      .eq('operator_id', memberId)
      .eq('tenant_id', tenantId)
      .select()
      .maybeSingle();
  }

  return result;
}

async function deleteMember(adminSb, tenantId, memberId) {
  let result = await adminSb
    .from('operator_members')
    .delete()
    .eq('id', memberId)
    .eq('tenant_id', tenantId);

  if (result.error && isMissingColumnError(result.error)) {
    result = await adminSb
      .from('operator_members')
      .delete()
      .eq('operator_id', memberId)
      .eq('tenant_id', tenantId);
  }

  return result;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { tenantId } = ctx;
  const adminSb = getAdminClient();
  const params = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    const { data, error } = await listMembers(adminSb, tenantId);
    if (error) return respond(500, { error: error.message });
    return respond(200, { members: (data || []).map(normalizeMemberRow) });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return respond(400, { error: 'Invalid JSON' });
    }

    const { email, name, role } = body;
    if (!email) return respond(400, { error: 'email is required' });

    const effectiveRole = role && UI_ROLES.includes(role) ? role : 'member';

    const { data: inviteData, error: inviteError } = await adminSb.auth.admin.inviteUserByEmail(email);
    if (inviteError) return respond(500, { error: inviteError.message });

    const invitedUser = inviteData?.user;
    if (!invitedUser?.id) return respond(500, { error: 'Failed to retrieve invited user id' });

    const { data, error } = await adminSb
      .from('operator_members')
      .insert({
        tenant_id: tenantId,
        user_id: invitedUser.id,
        role: storageRoleForUiRole(effectiveRole),
        name: name || null,
      })
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    if (!data) return respond(500, { error: 'Failed to create member: no record returned' });
    return respond(201, { member: normalizeMemberRow(data) });
  }

  if (event.httpMethod === 'PATCH') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return respond(400, { error: 'Invalid JSON' });
    }

    const { id, ...fields } = body;
    if (!id) return respond(400, { error: 'id is required' });

    const allowed = new Set([
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
    ]);
    const patch = Object.fromEntries(Object.entries(fields).filter(([key]) => allowed.has(key)));

    if (patch.role !== undefined && !UI_ROLES.includes(patch.role)) {
      return respond(400, { error: `role must be one of: ${UI_ROLES.join(', ')}` });
    }
    if (patch.role !== undefined) {
      patch.role = storageRoleForUiRole(patch.role);
    }

    if (patch.compensation_type !== undefined) {
      const normalizedType = normalizeCompensationType(patch.compensation_type);
      if (!normalizedType) {
        return respond(400, { error: 'compensation_type must be hourly, salary, day_rate, job_rate, commission, or blended' });
      }
      patch.compensation_type = normalizedType;
    }

    if (!Object.keys(patch).length) return respond(400, { error: 'No valid fields to update' });
    patch.updated_at = new Date().toISOString();

    const { data, error } = await updateMember(adminSb, tenantId, id, patch);
    if (error) return respond(500, { error: error.message });
    if (!data) return respond(404, { error: 'Member not found or access denied' });
    return respond(200, { member: normalizeMemberRow(data) });
  }

  if (event.httpMethod === 'DELETE') {
    const id = params.id;
    if (!id) return respond(400, { error: 'id is required' });

    const { error } = await deleteMember(adminSb, tenantId, id);
    if (error) return respond(500, { error: error.message });
    return respond(200, { ok: true });
  }

  return respond(405, { error: 'Method not allowed' });
};
