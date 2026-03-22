// netlify/functions/get-sms-thread.js
// Returns the SMS thread for a given phone number within the operator's tenant.
// GET ?phone=%2B1xxxxxxxxxx

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId } = ctx;
  const { phone } = event.queryStringParameters || {};
  if (!phone) return respond(400, { error: 'Missing phone parameter' });

  // Messages where the customer's number is either from or to
  const { data, error } = await supabase
    .from('sms_messages')
    .select('*')
    .eq('tenant_id', tenantId)
    .or(`from_number.eq.${phone},to_number.eq.${phone}`)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) {
    console.error('[get-sms-thread]', error);
    return respond(500, { error: 'Failed to fetch messages' });
  }

  return respond(200, { messages: data || [] });
};
