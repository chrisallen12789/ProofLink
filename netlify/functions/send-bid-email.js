// netlify/functions/send-bid-email.js
// Operator-authenticated POST — emails a bid/proposal to the customer.
// POST { bid_id }
// Reads the bid from the bids table, looks up the customer, sends a professional
// proposal email using the bidProposal template.

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
const { sendEmail, templates } = require('./utils/email');
const { getConfiguredSiteUrl } = require('./utils/runtime-config');

function clean(value) {
  return String(value || '').trim();
}

function businessNameFromTenant(tenant) {
  return clean(tenant?.business_name || tenant?.name) || 'Your service provider';
}

function isMissingDocumentEngineError(error) {
  const message = String(error?.message || error?.details || error?.hint || '');
  return /proposal_documents|proposal_document_versions|proposal_options/i.test(message);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const bid_id = clean(body.bid_id);
  const proposalDocumentId = clean(body.proposal_document_id);
  if (!bid_id) return respond(400, { error: 'bid_id is required' });

  // Fetch the bid
  const { data: bid, error: bidErr } = await supabase
    .from('bids')
    .select('id, tenant_id, title, project_summary, scope_of_work, total_cents, valid_until, cover_note, status, customer_id')
    .eq('id', bid_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (bidErr) { console.error('[send-bid-email] bid fetch:', bidErr); return respond(500, { error: 'Failed to load bid' }); }
  if (!bid) return respond(404, { error: 'Bid not found' });

  // Fetch customer
  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .select('id, name, email')
    .eq('id', bid.customer_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (custErr) { console.error('[send-bid-email] customer fetch:', custErr); return respond(500, { error: 'Failed to load customer' }); }
  if (!customer) return respond(404, { error: 'Customer not found for this bid' });
  if (!customer.email) return respond(400, { error: 'Customer has no email address on file' });

  let proposalDocument = null;
  if (proposalDocumentId) {
    const { data, error } = await supabase
      .from('proposal_documents')
      .select('id, public_token, status, revision_number')
      .eq('id', proposalDocumentId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error && !isMissingDocumentEngineError(error)) {
      console.error('[send-bid-email] proposal document fetch by id:', error);
      return respond(500, { error: 'Failed to load proposal document' });
    }
    proposalDocument = data || null;
  }
  if (!proposalDocument) {
    const { data, error } = await supabase
      .from('proposal_documents')
      .select('id, public_token, status, revision_number')
      .eq('bid_id', bid.id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error && !isMissingDocumentEngineError(error)) {
      console.error('[send-bid-email] proposal document fetch by bid:', error);
      return respond(500, { error: 'Failed to load proposal document' });
    }
    proposalDocument = data || null;
  }

  // Fetch business name
  const { data: tenant } = await supabase.from('tenants').select('business_name, name').eq('id', tenantId).maybeSingle();
  const businessName = businessNameFromTenant(tenant);
  const siteUrl = getConfiguredSiteUrl();
  const proposalToken = clean(proposalDocument?.public_token) || bid.id;
  const proposalUrl = `${siteUrl}/quote.html?token=${encodeURIComponent(proposalToken)}`;

  const delivery = await sendEmail(templates.bidProposal({
    customer_name: customer.name || 'Customer',
    customer_email: customer.email,
    business_name: businessName,
    title: bid.title || 'Proposal',
    project_summary: bid.project_summary || null,
    scope_of_work: bid.scope_of_work || null,
    total_cents: bid.total_cents != null ? bid.total_cents : null,
    valid_until: bid.valid_until || null,
    cover_note: bid.cover_note || null,
    proposal_url: proposalUrl,
  }));

  if (delivery?.error) {
    console.warn('[send-bid-email] email failed:', delivery.error);
    return respond(502, { error: 'Bid created but email delivery failed. Check your email config.' });
  }

  // Mark bid as sent
  const sentAt = new Date().toISOString();
  const warnings = [];

  const { error: bidStatusError } = await supabase
    .from('bids')
    .update({ status: bid.status === 'draft' ? 'sent' : bid.status, sent_at: sentAt, updated_at: sentAt })
    .eq('id', bid_id)
    .eq('tenant_id', tenantId);
  if (bidStatusError) {
    console.warn('[send-bid-email] bid status update:', bidStatusError);
    warnings.push('Bid status could not be updated after email delivery.');
  }

  if (proposalDocument?.id) {
    const { error: proposalUpdateError } = await supabase
      .from('proposal_documents')
      .update({
        status: proposalDocument.status === 'accepted' ? 'accepted' : 'sent',
        sent_at: sentAt,
        updated_at: sentAt,
      })
      .eq('id', proposalDocument.id)
      .eq('tenant_id', tenantId);
    if (proposalUpdateError && !isMissingDocumentEngineError(proposalUpdateError)) {
      console.error('[send-bid-email] proposal document update:', proposalUpdateError);
      warnings.push('Proposal status could not be updated after email delivery.');
    }
  }

  return respond(200, {
    ok: true,
    sent_to: customer.email,
    proposal_token: proposalToken,
    proposal_url: proposalUrl,
    warnings,
  });
};
