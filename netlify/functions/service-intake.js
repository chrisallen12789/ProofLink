const { getAdminClient, respond } = require('./utils/auth');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return {};
  }
}

function clean(value) {
  return String(value || '').trim();
}

function errorCode(error) {
  return String(error?.code || error?.error?.code || '').trim().toUpperCase();
}

function errorMessage(error) {
  return String(error?.message || error?.error?.message || '').trim();
}

function isMissingServiceWorkflowSchemaError(error) {
  const code = errorCode(error);
  const message = errorMessage(error).toLowerCase();
  return ["PGRST202", "PGRST205", "42P01", "42883"].includes(code)
    || message.includes("could not find the function public.submit_service_lead")
    || message.includes("function public.submit_service_lead")
    || message.includes("could not find the table 'public.leads'")
    || message.includes("relation \"public.leads\" does not exist");
}

function classifySubmitServiceLeadError(error) {
  const message = errorMessage(error);
  const normalized = message.toLowerCase();

  if (isMissingServiceWorkflowSchemaError(error)) {
    return {
      statusCode: 503,
      error: "Service workflow schema is not installed for this environment.",
    };
  }

  if (
    normalized.includes("tenant_id or tenant_slug is required")
    || normalized.includes("tenant could not be resolved")
    || normalized.includes("customer_name is required")
    || normalized.includes("summary is required")
    || normalized.includes("email or phone is required")
  ) {
    return {
      statusCode: 400,
      error: message || "Invalid service intake payload",
    };
  }

  if (normalized.includes("no operator found for tenant")) {
    return {
      statusCode: 503,
      error: "This workspace is not ready to receive service leads yet.",
    };
  }

  return {
    statusCode: 500,
    error: message || "Failed to submit service lead",
  };
}

async function resolveTenantRow(supabase, tenantId, tenantSlug) {
  if (tenantId) {
    const tenant = await supabase
      .from("tenants")
      .select("id,slug")
      .eq("id", tenantId)
      .maybeSingle();
    if (tenant.error) throw tenant.error;
    if (tenant.data) return tenant.data;
  }
  if (!tenantSlug) return null;
  const tenant = await supabase
    .from("tenants")
    .select("id,slug")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (tenant.error) throw tenant.error;
  return tenant.data || null;
}

async function resolveTenantOperator(supabase, tenantId) {
  const operator = await supabase
    .from("operators")
    .select("id")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (operator.error) throw operator.error;
  return operator.data || null;
}

async function findExistingCustomer(supabase, tenantId, operatorId, email, phone) {
  if (email) {
    const byEmail = await supabase
      .from("customers")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("operator_id", operatorId)
      .ilike("email", email)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byEmail.error) throw byEmail.error;
    if (byEmail.data) return byEmail.data;
  }

  if (phone) {
    const byPhone = await supabase
      .from("customers")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("operator_id", operatorId)
      .eq("phone", phone)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byPhone.error) throw byPhone.error;
    if (byPhone.data) return byPhone.data;
  }

  return null;
}

async function submitServiceLeadFallback(supabase, payload) {
  const tenant = await resolveTenantRow(supabase, payload.tenant_id, payload.tenant_slug);
  if (!tenant?.id) {
    throw new Error("submit_service_lead: tenant could not be resolved");
  }

  const operator = await resolveTenantOperator(supabase, tenant.id);
  if (!operator?.id) {
    throw new Error(`submit_service_lead: no operator found for tenant ${tenant.id}`);
  }

  const nowIso = new Date().toISOString();
  const customerName = clean(payload.customer_name || payload.name);
  const email = clean(payload.email).toLowerCase() || null;
  const phone = clean(payload.phone) || null;
  const preferredContact = clean(payload.preferred_contact) || "phone";
  const summary = clean(payload.summary || payload.project_summary || payload.notes);
  const requestedServiceType = clean(payload.requested_service_type || payload.service_type) || null;
  const serviceAddress = clean(payload.service_address) || null;
  const sourceType = clean(payload.source_type) || "website_service_intake";

  let customer = await findExistingCustomer(supabase, tenant.id, operator.id, email, phone);
  if (!customer) {
    const insert = await supabase
      .from("customers")
      .insert({
        tenant_id: tenant.id,
        operator_id: operator.id,
        name: customerName,
        email,
        phone,
        preferred_contact: preferredContact,
        notes: summary,
        last_contact_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("*")
      .single();
    if (insert.error) throw insert.error;
    customer = insert.data;
  } else {
    const update = await supabase
      .from("customers")
      .update({
        name: customerName || customer.name,
        email: email || customer.email,
        phone: phone || customer.phone,
        preferred_contact: preferredContact || customer.preferred_contact,
        last_contact_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", customer.id)
      .select("*")
      .single();
    if (update.error) throw update.error;
    customer = update.data;
  }

  const leadInsert = await supabase
    .from("leads")
    .insert({
      tenant_id: tenant.id,
      operator_id: operator.id,
      customer_id: customer.id,
      status: "new",
      source_type: sourceType,
      source_ref: tenant.slug || payload.tenant_slug || null,
      title: requestedServiceType || "Service request",
      summary,
      requested_service_type: requestedServiceType,
      service_address: serviceAddress,
      contact_name: customerName,
      contact_email: email,
      contact_phone: phone,
      preferred_contact: preferredContact,
      notes: summary,
      metadata: {
        submitted_via: sourceType,
        fallback_mode: "netlify_function",
      },
      last_activity_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id,tenant_id,customer_id,operator_id")
    .single();

  if (leadInsert.error) throw leadInsert.error;

  return {
    lead_id: leadInsert.data.id,
    customer_id: customer.id,
    operator_id: operator.id,
    tenant_id: tenant.id,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `service-intake:${ip}`, maxRequests: 10, windowMs: 600000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const body = parseBody(event);
  const tenantId = clean(body.tenant_id || body.tenantId);
  const tenantSlug = clean(body.tenant_slug || body.tenantSlug);
  const customerName = clean(body.customer_name || body.name);
  const email = clean(body.email).toLowerCase();
  const phone = clean(body.phone);
  const summary = clean(body.summary || body.project_summary || body.notes);

  if (!tenantId && !tenantSlug) {
    return respond(400, { error: 'tenant_id or tenant_slug is required' });
  }
  if (!customerName) {
    return respond(400, { error: 'customer_name is required' });
  }
  if (!email && !phone) {
    return respond(400, { error: 'email or phone is required' });
  }
  if (!summary) {
    return respond(400, { error: 'summary is required' });
  }

  let supabase;
  try {
    supabase = getAdminClient();
  } catch (err) {
    return respond(500, { error: err.message || 'Supabase configuration is missing' });
  }

  const payload = {
    tenant_id: tenantId || undefined,
    tenant_slug: tenantSlug || undefined,
    customer_name: customerName,
    email: email || undefined,
    phone: phone || undefined,
    preferred_contact: clean(body.preferred_contact || body.preferredContact) || undefined,
    summary,
    requested_service_type: clean(body.requested_service_type || body.requestedServiceType || body.service_type) || undefined,
    service_address: clean(body.service_address || body.serviceAddress) || undefined,
    source_type: clean(body.source_type || body.sourceType) || 'website_service_intake',
  };

  let data;
  const rpcResult = await supabase.rpc('submit_service_lead', { payload });
  if (rpcResult.error) {
    if (isMissingServiceWorkflowSchemaError(rpcResult.error)) {
      try {
        data = await submitServiceLeadFallback(supabase, payload);
      } catch (fallbackError) {
        console.error('[service-intake] fallback submitServiceLead failed:', fallbackError);
        const classified = classifySubmitServiceLeadError(fallbackError);
        return respond(classified.statusCode, { error: classified.error });
      }
    } else {
      console.error('[service-intake] submit_service_lead failed:', rpcResult.error);
      const classified = classifySubmitServiceLeadError(rpcResult.error);
      return respond(classified.statusCode, { error: classified.error });
    }
  } else {
    data = rpcResult.data;
  }

  if (!data?.lead_id || !data?.customer_id || !data?.tenant_id) {
    console.error('[service-intake] submit_service_lead returned incomplete linkage:', data);
    return respond(502, {
      error: 'Service intake did not return a complete lead/customer linkage.',
    });
  }

  return respond(201, {
    ok: true,
    lead_id: data?.lead_id || null,
    customer_id: data?.customer_id || null,
    tenant_id: data?.tenant_id || tenantId || null,
  });
};
