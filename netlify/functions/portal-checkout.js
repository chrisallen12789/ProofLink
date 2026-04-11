// FILE: netlify/functions/portal-checkout.js
// PUBLIC endpoint — no operator auth required.
// Manual-payments mode. Returns a clear response so the portal can route the
// customer to invoice/manual instructions instead of online checkout.

const { getAdminClient, respond } = require('./utils/auth');
const { manualPaymentsOnlyMessage } = require('./_prooflink_payments');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

const TERMINAL_STATUSES = new Set(['cancelled', 'canceled', 'void', 'paid']);
const getManualPaymentsOnlyMessage = () =>
  typeof manualPaymentsOnlyMessage === 'function'
    ? manualPaymentsOnlyMessage()
    : 'ProofLink is currently running in manual-payments mode. Online checkout and automated billing are unavailable.';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, { ok: true });
  if (event.httpMethod !== 'GET') {
    return respond(405, { ok: false, error: 'Method not allowed' });
  }

  // Rate limit: 30 portal checkout requests per minute per IP
  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `portal-checkout:${ip}`, maxRequests: 30, windowMs: 60000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  try {
    const params = event.queryStringParameters || {};
    const orderId = (params.order_id || '').trim();
    const email   = (params.email   || '').trim();

    if (!orderId || !email) {
      return respond(400, { ok: false, error: 'order_id and email query parameters are required' });
    }

    const supabase = getAdminClient();

    // --- Fetch the order ---
    const { data: orderRows, error: orderErr } = await supabase
      .from('orders')
      .select('id, tenant_id, email, total_cents, amount_paid_cents, amount_due_cents, payment_state, status, cart_summary')
      .eq('id', orderId)
      .limit(1);

    if (orderErr) {
      console.error('[portal-checkout] order fetch error:', orderErr);
      return respond(500, { ok: false, error: 'Failed to fetch order' });
    }

    const order = Array.isArray(orderRows) ? orderRows[0] : null;
    if (!order) {
      return respond(404, { ok: false, error: 'Order not found' });
    }

    // --- Verify email matches (case-insensitive) ---
    const storedEmail  = (order.email || '').toLowerCase();
    const providedEmail = email.toLowerCase();
    if (!storedEmail || storedEmail !== providedEmail) {
      return respond(403, { ok: false, error: 'Email does not match order records' });
    }

    // --- Verify order is in a payable state ---
    const status = (order.status || '').toLowerCase();
    if (TERMINAL_STATUSES.has(status)) {
      const messages = {
        paid      : 'This order has already been paid in full.',
        cancelled : 'This order has been cancelled and cannot be paid.',
        canceled  : 'This order has been cancelled and cannot be paid.',
        void      : 'This order has been voided and cannot be paid.',
      };
      return respond(400, {
        ok     : false,
        error  : messages[status] || `Order status "${order.status}" cannot be paid online.`,
        status : order.status,
      });
    }

    // --- Calculate outstanding balance ---
    const totalCents = Number(order.total_cents) || 0;
    const amountPaid = Number(order.amount_paid_cents) || 0;
    const explicitAmountDue = Number(order.amount_due_cents);
    const balanceCents = Number.isFinite(explicitAmountDue)
      ? explicitAmountDue
      : totalCents - amountPaid;

    if (balanceCents <= 0) {
      return respond(400, { ok: false, error: 'No outstanding balance' });
    }

    if (balanceCents < 50) {
      return respond(400, { ok: false, error: 'Outstanding balance is below the minimum charge amount ($0.50)' });
    }

    // --- Fetch tenant contact context ---
    const { data: tenantRows, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, business_name, owner_email')
      .eq('id', order.tenant_id)
      .limit(1);

    if (tenantErr) {
      console.error('[portal-checkout] tenant fetch error:', tenantErr);
      return respond(500, { ok: false, error: 'Failed to fetch provider details' });
    }

    const tenant = Array.isArray(tenantRows) ? tenantRows[0] : null;
    if (!tenant) {
      console.error('[portal-checkout] tenant not found for order tenant_id:', order.tenant_id);
      return respond(404, { ok: false, error: 'Provider not found' });
    }

    return respond(503, {
      ok: false,
      error: getManualPaymentsOnlyMessage(),
      contact_needed: true,
      code: 'manual_payments_only',
      payment_help: {
        business_name: tenant.business_name || '',
        contact_email: tenant.owner_email || '',
        order_id: orderId,
        amount_due_cents: balanceCents,
      },
    });

  } catch (e) {
    console.error('[portal-checkout] unexpected error:', e);
    return respond(Number(e.statusCode || 500), {
      ok   : false,
      error: e.message || String(e),
    });
  }
};
