// netlify/functions/blog-comment.js
// Accepts a comment submission for a blog article.
// Stores in blog_comments. If notify_subscribe is true, also upserts into blog_subscribers.
// Rate limited: 5 submissions per 10 minutes per IP.

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
  return String(val || '').trim().slice(0, 2000);
}

function cleanEmail(val) {
  return String(val || '').trim().toLowerCase().slice(0, 320);
}

function cleanShort(val) {
  return String(val || '').trim().slice(0, 200);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidSlug(slug) {
  return /^[a-z0-9-]{1,200}$/.test(slug);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `blog-comment:${ip}`, maxRequests: 5, windowMs: 600000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { ok: false, error: 'Invalid JSON' });
  }

  // Honeypot
  if (body.fax || body.website) {
    return json(200, { ok: true }); // silent reject
  }

  const article_slug      = clean(body.article_slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 200);
  const name              = cleanShort(body.name);
  const email             = cleanEmail(body.email);
  const comment           = clean(body.comment);
  const notify_subscribe  = body.notify_subscribe === true || body.notify_subscribe === 'true';

  // Validate
  if (!article_slug || !isValidSlug(article_slug)) {
    return json(400, { ok: false, error: 'Invalid article.' });
  }
  if (!name || name.length < 2) {
    return json(400, { ok: false, error: 'Please enter your name.' });
  }
  if (!email || !isValidEmail(email)) {
    return json(400, { ok: false, error: 'Please enter a valid email address.' });
  }
  if (!comment || comment.length < 10) {
    return json(400, { ok: false, error: 'Comment must be at least 10 characters.' });
  }

  const supabase = getAdminClient();

  // Insert comment
  const { error: commentErr } = await supabase
    .from('blog_comments')
    .insert([{
      article_slug,
      name,
      email,
      comment,
      created_at: new Date().toISOString(),
    }]);

  if (commentErr) {
    console.error('[blog-comment] insert error:', commentErr.message);
    return json(500, { ok: false, error: 'Failed to save comment. Please try again.' });
  }

  // If subscriber opt-in, upsert into blog_subscribers
  if (notify_subscribe) {
    await supabase
      .from('blog_subscribers')
      .upsert([{
        email,
        name,
        source: article_slug,
        created_at: new Date().toISOString(),
      }], { onConflict: 'email', ignoreDuplicates: true })
      .catch((e) => console.warn('[blog-comment] subscriber upsert non-fatal:', e.message));
  }

  return json(201, { ok: true, message: 'Comment submitted. Thank you!' });
};
