const { clean, json, readJson, requireOperatorContext, supabaseAdmin } = require('./_prooflink_payments');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  try {
    await requireOperatorContext(event);

    const body = readJson(event);

    const payload = {
      business_name: clean(body.business_name || body.businessName),
      owner_name: clean(body.owner_name || body.ownerName),
      email: clean(body.email).toLowerCase(),
      phone: clean(body.phone),
      business_category: clean(body.business_category || body.businessCategory),
      selected_plan: clean(body.selected_plan || body.selectedPlan || 'starter').toLowerCase(),
      fulfillment_model: clean(body.fulfillment_model || body.fulfillmentModel || 'pickup').toLowerCase(),
      service_area: clean(body.service_area || body.serviceArea),
      brand_color: clean(body.brand_color || body.brandColor || '#c9a227'),
      logo_url: clean(body.logo_url || body.logoUrl),
      subdomain_preference: clean(body.subdomain_preference || body.subdomainPreference),
      platform_name: clean(body.platform_name || body.platformName || 'ProofLink'),
      user_id: clean(body.user_id || body.userId || ''),
      notes: clean(body.notes)
    };

    if (!payload.business_name) throw Object.assign(new Error('business_name is required.'), { statusCode: 400 });
    if (!payload.owner_name) throw Object.assign(new Error('owner_name is required.'), { statusCode: 400 });
    if (!payload.email) throw Object.assign(new Error('email is required.'), { statusCode: 400 });
    if (!payload.phone) throw Object.assign(new Error('phone is required.'), { statusCode: 400 });
    if (!payload.business_category) throw Object.assign(new Error('business_category is required.'), { statusCode: 400 });

    const result = await supabaseAdmin('/rest/v1/rpc/create_tenant_bundle', 'POST', payload);

    return json(200, {
      ok: true,
      result,
    });
  } catch (e) {
    return json(Number(e.statusCode || 500), {
      ok: false,
      error: e.message || String(e),
    });
  }
};