// netlify/functions/blog-subscribe.js
// Accepts a newsletter subscription from the blog subscribe form.
// Upserts into blog_subscribers — duplicate emails are silently ignored.
// Rate limited: 5 per 10 minutes per IP.

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      'Content-Type'               : 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(obj),
  };
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function clean(val) {
  return String(val || '').trim().slice(0, 200);
}

function cleanEmail(val) {
  return String(val || '').trim().toLowerCase().slice(0, 320);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `blog-subscribe:${ip}`, maxRequests: 5, windowMs: 600000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { ok: false, error: 'Invalid JSON' });
  }

  // Honeypot
  if (body.fax || body.website) {
    return json(200, { ok: true });
  }

  const name   = clean(body.name);
  const email  = cleanEmail(body.email);
  const source = clean(body.source || 'blog');

  if (!name || name.length < 2) {
    return json(400, { ok: false, error: 'Please enter your name.' });
  }
  if (!email || !isValidEmail(email)) {
    return json(400, { ok: false, error: 'Please enter a valid email address.' });
  }

  const supabase = getAdminClient();

  const { error } = await supabase
    .from('blog_subscribers')
    .upsert([{
      email,
      name,
      source,
      created_at: new Date().toISOString(),
    }], { onConflict: 'email', ignoreDuplicates: true });

  if (error) {
    console.error('[blog-subscribe] upsert error:', error.message);
    return json(500, { ok: false, error: 'Failed to subscribe. Please try again.' });
  }

  return json(201, { ok: true, message: "You're subscribed. We'll be in touch." });
};
