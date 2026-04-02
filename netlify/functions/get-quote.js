// netlify/functions/get-quote.js
// Public endpoint for customer-facing proposal retrieval and acceptance.
// Accepts either a proposal document public token or a legacy bid id.

'use strict';

const { getAdminClient, respond } = require('./utils/auth');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');
const engine = require('../../shared/proposal-document-engine.js');

const BID_SELECT = [
  'id',
  'tenant_id',
  'title',
  'profile',
  'project_summary',
  'scope_of_work',
  'proposed_solution',
  'service_address',
  'site_contact',
  'total_cents',
  'valid_until',
  'cover_note',
  'status',
  'customer_id',
  'lead_id',
  'created_at',
  'walkthrough_at',
  'line_items',
].join(', ');

function clean(value) {
  return String(value || '').trim();
}

function isMissingDocumentEngineError(error) {
  const message = String(error?.message || error?.details || error?.hint || '');
  return /proposal_documents|proposal_document_versions|proposal_options|tenant_branding_profiles|user_document_profiles/i.test(message);
}

function normalizeLineItem(item) {
  const quantity = Number(item?.quantity ?? item?.qty ?? 1) || 1;
  const unitPriceCents = Number(
    item?.unit_price_cents
    ?? item?.unitPriceCents
    ?? item?.unit_price
    ?? item?.price_cents
    ?? item?.price
    ?? 0
  ) || 0;
  const explicitLineTotalCents = Number(
    item?.line_total_cents
    ?? item?.lineTotalCents
    ?? item?.total_cents
    ?? item?.totalCents
  );
  const lineTotalCents = Number.isFinite(explicitLineTotalCents)
    ? explicitLineTotalCents
    : Math.round(quantity * unitPriceCents);

  return {
    id: item?.id || null,
    name: item?.name || item?.description || 'Item',
    description: item?.description || '',
    note: item?.note || '',
    quantity,
    qty: quantity,
    unit: item?.unit || 'item',
    unit_price_cents: unitPriceCents,
    unit_price: unitPriceCents / 100,
    price: unitPriceCents / 100,
    line_total_cents: lineTotalCents,
    line_total: lineTotalCents / 100,
    total: lineTotalCents / 100,
  };
}

function maskEmail(email) {
  const normalized = clean(email).toLowerCase();
  if (!normalized || !normalized.includes('@')) return '';
  const [local, domain] = normalized.split('@');
  if (!local || !domain) return '';
  if (local.length <= 2) return `${local.charAt(0)}*@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

function publicStatus(value) {
  const status = clean(value).toLowerCase();
  if (status === 'approved') return 'accepted';
  if (status === 'pending' || status === 'review') return 'sent';
  return status || 'draft';
}

function buildLegacyOptionsFromBid(bid) {
  const totalCents = Number(bid?.total_cents || 0);
  return [{
    option_title: clean(bid?.title) || 'Base scope',
    pricing_label: 'Investment',
    price_amount_cents: totalCents,
    scope_content: clean(bid?.scope_of_work) || clean(bid?.proposed_solution) || clean(bid?.project_summary),
    notes: '',
  }];
}

async function maybeSingleQuery(query) {
  const result = await query;
  return { data: result.data || null, error: result.error || null };
}

async function loadProposalDocumentByTokenOrBidId(supabase, token) {
  const byToken = await maybeSingleQuery(
    supabase
      .from('proposal_documents')
      .select('*')
      .eq('public_token', token)
      .maybeSingle()
  );
  if (byToken.error && !isMissingDocumentEngineError(byToken.error)) throw byToken.error;
  if (byToken.data) return byToken.data;

  const byBidId = await maybeSingleQuery(
    supabase
      .from('proposal_documents')
      .select('*')
      .eq('bid_id', token)
      .maybeSingle()
  );
  if (byBidId.error && !isMissingDocumentEngineError(byBidId.error)) throw byBidId.error;
  return byBidId.data || null;
}

async function loadProposalOptions(supabase, proposalDocumentId) {
  if (!proposalDocumentId) return [];
  const { data, error } = await supabase
    .from('proposal_options')
    .select('*')
    .eq('proposal_document_id', proposalDocumentId)
    .order('sort_order', { ascending: true });
  if (error && !isMissingDocumentEngineError(error)) throw error;
  return Array.isArray(data) ? data : [];
}

async function loadTenantBrandingProfile(supabase, tenantId) {
  if (!tenantId) return null;
  const { data, error } = await supabase
    .from('tenant_branding_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error && !isMissingDocumentEngineError(error)) throw error;
  return data || null;
}

async function loadSenderProfiles(supabase, tenantId, proposalDocument, brandingProfile) {
  const senderUserId = clean(proposalDocument?.sender_user_id);
  const defaultSenderUserId = clean(brandingProfile?.default_sender_user_id);
  if (!tenantId || (!senderUserId && !defaultSenderUserId)) {
    return { senderProfile: null, defaultSenderProfile: null };
  }
  const { data, error } = await supabase
    .from('user_document_profiles')
    .select('*')
    .eq('tenant_id', tenantId);
  if (error && !isMissingDocumentEngineError(error)) throw error;
  const rows = Array.isArray(data) ? data : [];
  return {
    senderProfile: rows.find((row) => clean(row.user_id) === senderUserId) || null,
    defaultSenderProfile: rows.find((row) => clean(row.user_id) === defaultSenderUserId) || rows.find((row) => row.is_default_signer) || null,
  };
}

function buildLegacyDocumentModel({ bid, proposalDocument, proposalOptions, tenant, brandingProfile, senderProfile, defaultSenderProfile, customerName, customerAddress }) {
  return engine.buildProposalViewModel({
    document: {
      id: proposalDocument?.id || bid.id,
      public_token: clean(proposalDocument?.public_token) || bid.id,
      template_type: clean(proposalDocument?.template_type) || engine.TEMPLATE_TYPES.STANDARD_OPERATIONAL,
      service_type: clean(proposalDocument?.service_type) || clean(bid?.profile) || 'general_service',
      status: publicStatus(proposalDocument?.status || bid?.status),
      proposal_date: proposalDocument?.proposal_date || bid?.walkthrough_at || bid?.created_at,
      expiration_date: proposalDocument?.expiration_date || bid?.valid_until || null,
      recipient_name: proposalDocument?.recipient_name || customerName || bid?.site_contact || '',
      recipient_company: proposalDocument?.recipient_company || '',
      recipient_address: proposalDocument?.recipient_address || customerAddress || '',
      attention_line: proposalDocument?.attention_line || customerName || bid?.site_contact || '',
      subject_line: proposalDocument?.subject_line || bid?.title || '',
      project_name: proposalDocument?.project_name || bid?.title || '',
      site_address: proposalDocument?.site_address || bid?.service_address || '',
      intro_text: proposalDocument?.intro_text || bid?.cover_note || '',
      value_proposition_text: proposalDocument?.value_proposition_text || bid?.project_summary || '',
      notes_text: proposalDocument?.notes_text || '',
      terms_override: proposalDocument?.terms_override || '',
      exclusions_override: proposalDocument?.exclusions_override || '',
      revision_number: Number(proposalDocument?.revision_number || 1) || 1,
      viewed_at: proposalDocument?.viewed_at || null,
      sent_at: proposalDocument?.sent_at || null,
      accepted_at: proposalDocument?.accepted_at || null,
    },
    options: proposalOptions.length ? proposalOptions : buildLegacyOptionsFromBid(bid),
    tenantBrandingProfile: brandingProfile || {},
    tenant: tenant || {},
    senderProfile: senderProfile || {},
    defaultSenderProfile: defaultSenderProfile || {},
    serviceType: clean(proposalDocument?.service_type) || clean(bid?.profile) || 'general_service',
  });
}

async function loadQuoteContext(supabase, token) {
  const proposalDocument = await loadProposalDocumentByTokenOrBidId(supabase, token);
  const bidId = clean(proposalDocument?.bid_id) || token;
  const { data: bid, error: bidError } = await supabase
    .from('bids')
    .select(BID_SELECT)
    .eq('id', bidId)
    .maybeSingle();
  if (bidError) throw bidError;
  if (!bid) return null;

  const proposalOptions = proposalDocument?.id
    ? await loadProposalOptions(supabase, proposalDocument.id)
    : [];

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, logo_url, primary_color, email, notification_email, phone')
    .eq('id', bid.tenant_id)
    .maybeSingle();

  let customerName = null;
  let customerEmail = null;
  let customerAddress = null;
  if (bid.customer_id) {
    const { data: customer } = await supabase
      .from('customers')
      .select('name, email, address')
      .eq('id', bid.customer_id)
      .maybeSingle();
    customerName = customer?.name || null;
    customerEmail = customer?.email || null;
    customerAddress = customer?.address || null;
  }
  if (!customerEmail && bid.lead_id) {
    const { data: lead } = await supabase
      .from('leads')
      .select('contact_name, contact_email, service_address')
      .eq('id', bid.lead_id)
      .maybeSingle();
    customerName = customerName || lead?.contact_name || null;
    customerEmail = lead?.contact_email || null;
    customerAddress = customerAddress || lead?.service_address || null;
  }

  const brandingProfile = await loadTenantBrandingProfile(supabase, bid.tenant_id);
  const { senderProfile, defaultSenderProfile } = await loadSenderProfiles(supabase, bid.tenant_id, proposalDocument, brandingProfile);
  const lineItems = Array.isArray(bid.line_items) ? bid.line_items.map(normalizeLineItem) : [];

  const model = proposalDocument?.render_state && Object.keys(proposalDocument.render_state || {}).length
    ? proposalDocument.render_state
    : buildLegacyDocumentModel({
        bid,
        proposalDocument,
        proposalOptions,
        tenant,
        brandingProfile,
        senderProfile,
        defaultSenderProfile,
        customerName,
        customerAddress,
      });

  return {
    bid,
    proposalDocument,
    proposalOptions,
    tenant: tenant || null,
    customerName,
    customerEmail,
    customerAddress,
    lineItems,
    documentModel: engine.buildProposalViewModel({
      document: model,
      options: model?.options,
      tenantBrandingProfile: model?.branding,
      senderProfile: model?.sender,
      serviceType: model?.serviceType,
    }),
  };
}

async function markProposalViewed(supabase, proposalDocument) {
  if (!proposalDocument?.id) return proposalDocument;
  const currentStatus = clean(proposalDocument.status).toLowerCase();
  if (proposalDocument.viewed_at || ['accepted', 'rejected', 'archived', 'superseded'].includes(currentStatus)) {
    return proposalDocument;
  }
  const viewedAt = new Date().toISOString();
  const nextStatus = currentStatus === 'sent' ? 'viewed' : proposalDocument.status;
  const { error } = await supabase
    .from('proposal_documents')
    .update({
      viewed_at: viewedAt,
      status: nextStatus,
      updated_at: viewedAt,
    })
    .eq('id', proposalDocument.id);
  if (error && !isMissingDocumentEngineError(error)) throw error;
  return {
    ...proposalDocument,
    viewed_at: viewedAt,
    status: nextStatus,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `get-quote:${ip}`, maxRequests: 20, windowMs: 15 * 60 * 1000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return respond(400, { error: 'Invalid JSON' });
    }

    const action = clean(body.action).toLowerCase();
    const requestToken = clean(body.bid_id || body.token || body.id);
    const submittedCustomerEmail = clean(body.customer_email).toLowerCase();
    if (action !== 'accept') return respond(400, { error: 'Invalid action' });
    if (!requestToken) return respond(400, { error: 'bid_id is required' });

    const quoteWindow = checkRateLimit({ key: `get-quote:${ip}:${requestToken}`, maxRequests: 6, windowMs: 15 * 60 * 1000 });
    if (!quoteWindow.allowed) return rateLimitResponse(quoteWindow.retryAfterMs);

    const supabase = getAdminClient();

    let ctx;
    try {
      ctx = await loadQuoteContext(supabase, requestToken);
    } catch (error) {
      console.error('[get-quote] POST accept load:', error);
      return respond(500, { error: 'Failed to load proposal' });
    }
    if (!ctx?.bid) return respond(404, { error: 'Proposal not found' });

    const proposalDocument = ctx.proposalDocument;
    const publicBidStatus = publicStatus(proposalDocument?.status || ctx.bid.status);
    if (publicBidStatus === 'accepted') {
      return respond(200, { ok: true, message: 'Already accepted' });
    }
    if (publicBidStatus && !['draft', 'sent', 'viewed', 'accepted'].includes(publicBidStatus)) {
      return respond(409, { error: `Proposal cannot be accepted - current status: ${publicBidStatus}` });
    }

    const expiration = proposalDocument?.expiration_date || ctx.bid.valid_until;
    if (expiration) {
      const expiry = new Date(expiration);
      if (!Number.isNaN(expiry.getTime()) && expiry < new Date()) {
        return respond(410, { error: 'This proposal has expired and can no longer be accepted. Please contact us for a revised proposal.' });
      }
    }

    if (!ctx.customerEmail) {
      return respond(409, { error: 'This proposal needs direct confirmation from the business before it can be approved online.' });
    }
    if (submittedCustomerEmail !== clean(ctx.customerEmail).toLowerCase()) {
      return respond(403, { error: 'Please enter the same email address this proposal was sent to before approving it.' });
    }

    const nowIso = new Date().toISOString();
    const { data: updatedRows, error: bidUpdateError } = await supabase
      .from('bids')
      .update({ status: 'approved', approved_at: nowIso, updated_at: nowIso })
      .eq('id', ctx.bid.id)
      .not('status', 'eq', 'approved')
      .select('id');
    if (bidUpdateError) {
      console.error('[get-quote] POST accept update:', bidUpdateError);
      return respond(500, { error: 'Failed to accept proposal' });
    }
    if (!updatedRows || updatedRows.length === 0) {
      return respond(409, { error: 'Proposal has already been accepted or is no longer available' });
    }

    if (proposalDocument?.id) {
      let acceptedVersionId = null;
      const { data: latestVersion, error: latestVersionError } = await supabase
        .from('proposal_document_versions')
        .select('id')
        .eq('proposal_document_id', proposalDocument.id)
        .order('revision_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestVersionError && !isMissingDocumentEngineError(latestVersionError)) {
        console.error('[get-quote] POST accept version lookup:', latestVersionError);
        return respond(500, { error: 'Failed to finalize accepted proposal' });
      }
      acceptedVersionId = latestVersion?.id || null;

      const { error: proposalUpdateError } = await supabase
        .from('proposal_documents')
        .update({
          status: 'accepted',
          accepted_at: nowIso,
          viewed_at: proposalDocument.viewed_at || nowIso,
          accepted_version_id: acceptedVersionId,
          updated_at: nowIso,
        })
        .eq('id', proposalDocument.id);
      if (proposalUpdateError && !isMissingDocumentEngineError(proposalUpdateError)) {
        console.error('[get-quote] POST accept proposal update:', proposalUpdateError);
        return respond(500, { error: 'Failed to finalize accepted proposal' });
      }
    }

    const toEmail = ctx.tenant?.notification_email || ctx.tenant?.email || null;
    if (toEmail && process.env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: 'ProofLink <noreply@prooflink.app>',
            to: [toEmail],
            subject: `A customer accepted your proposal: ${ctx.bid.title}`,
            text: `${ctx.customerName || 'A customer'} accepted your proposal '${ctx.bid.title}'. Log in to ProofLink to convert it to an order.`,
          }),
        });
      } catch (resendErr) {
        console.warn('[get-quote] Resend notification failed:', resendErr);
      }
    }

    return respond(200, { ok: true });
  }

  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  const params = event.queryStringParameters || {};
  const requestToken = clean(params.token || params.id);
  if (!requestToken) return respond(400, { error: 'Missing token' });
  const quoteWindow = checkRateLimit({ key: `get-quote:${ip}:${requestToken}`, maxRequests: 6, windowMs: 15 * 60 * 1000 });
  if (!quoteWindow.allowed) return rateLimitResponse(quoteWindow.retryAfterMs);

  const supabase = getAdminClient();

  let ctx;
  try {
    ctx = await loadQuoteContext(supabase, requestToken);
  } catch (error) {
    console.error('[get-quote] GET load:', error);
    return respond(500, { error: 'Failed to load proposal' });
  }
  if (!ctx?.bid) return respond(404, { error: 'Proposal not found' });

  let proposalDocument = ctx.proposalDocument;
  try {
    proposalDocument = await markProposalViewed(supabase, proposalDocument);
  } catch (error) {
    console.warn('[get-quote] view tracking failed:', error);
  }

  const documentModel = {
    ...ctx.documentModel,
    status: publicStatus(proposalDocument?.status || ctx.bid.status),
    viewedAt: proposalDocument?.viewed_at || ctx.documentModel?.viewedAt || '',
    acceptedAt: proposalDocument?.accepted_at || ctx.documentModel?.acceptedAt || '',
    sentAt: proposalDocument?.sent_at || ctx.documentModel?.sentAt || '',
  };
  const documentHtml = engine.renderDocumentBody(documentModel);
  const businessName = documentModel?.branding?.companyName || ctx.tenant?.name || null;
  const businessLogoUrl = documentModel?.branding?.logoUrl || ctx.tenant?.logo_url || null;
  const contactEmail = documentModel?.sender?.email || documentModel?.branding?.email || ctx.tenant?.notification_email || ctx.tenant?.email || null;
  const contactPhone = documentModel?.sender?.phone || documentModel?.branding?.phone || ctx.tenant?.phone || null;
  const publicToken = clean(proposalDocument?.public_token) || ctx.bid.id;

  return respond(200, {
    ok: true,
    quote: {
      id: proposalDocument?.id || ctx.bid.id,
      bid_id: ctx.bid.id,
      proposal_token: publicToken,
      title: documentModel.projectName || ctx.bid.title,
      project_summary: ctx.bid.project_summary,
      scope_of_work: ctx.bid.scope_of_work,
      total_cents: ctx.bid.total_cents,
      total_amount: ctx.bid.total_cents != null ? Number(ctx.bid.total_cents) / 100 : null,
      valid_until: proposalDocument?.expiration_date || ctx.bid.valid_until,
      cover_note: ctx.bid.cover_note,
      status: documentModel.status,
      created_at: ctx.bid.created_at,
      customer_name: ctx.customerName,
      business_name: businessName,
      logo_url: businessLogoUrl,
      business_logo_url: businessLogoUrl,
      primary_color: documentModel?.branding?.primaryColor || ctx.tenant?.primary_color || null,
      business_email: contactEmail,
      business_phone: contactPhone,
      notes: documentModel.notesText || ctx.bid.cover_note || null,
      terms: documentModel.termsText || ctx.bid.scope_of_work || null,
      line_items: ctx.lineItems,
      recipient_email_hint: maskEmail(ctx.customerEmail),
      template_type: documentModel.templateType,
      proposal_document_id: proposalDocument?.id || null,
      proposal_revision_number: Number(proposalDocument?.revision_number || documentModel.revisionNumber || 1),
      document_model: documentModel,
      document_html: documentHtml,
      rendered_html_snapshot: proposalDocument?.rendered_html_snapshot || null,
    },
    id: proposalDocument?.id || ctx.bid.id,
    bid_id: ctx.bid.id,
    proposal_token: publicToken,
    title: documentModel.projectName || ctx.bid.title,
    total_cents: ctx.bid.total_cents,
    total_amount: ctx.bid.total_cents != null ? Number(ctx.bid.total_cents) / 100 : null,
    valid_until: proposalDocument?.expiration_date || ctx.bid.valid_until,
    cover_note: ctx.bid.cover_note,
    status: documentModel.status,
    created_at: ctx.bid.created_at,
    customer_name: ctx.customerName,
    business_name: businessName,
    business_logo_url: businessLogoUrl,
    business_email: contactEmail,
    business_phone: contactPhone,
    notes: documentModel.notesText || ctx.bid.cover_note || null,
    terms: documentModel.termsText || ctx.bid.scope_of_work || null,
    line_items: ctx.lineItems,
    recipient_email_hint: maskEmail(ctx.customerEmail),
    template_type: documentModel.templateType,
    proposal_document_id: proposalDocument?.id || null,
    proposal_revision_number: Number(proposalDocument?.revision_number || documentModel.revisionNumber || 1),
    document_model: documentModel,
    document_html: documentHtml,
    rendered_html_snapshot: proposalDocument?.rendered_html_snapshot || null,
  });
};
