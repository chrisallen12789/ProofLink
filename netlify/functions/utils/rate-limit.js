// netlify/functions/utils/rate-limit.js
// Simple in-memory rate limiter for Netlify functions.
// Uses a sliding window counter per key. State resets on function cold start,
// which is acceptable for the protection level needed.

'use strict';

const windows = {};  // { key: { count, resetAt } }

/**
 * checkRateLimit({ key, maxRequests, windowMs })
 *
 * Returns { allowed: true } if within limits.
 * Returns { allowed: false, retryAfterMs } if rate exceeded.
 *
 * key         — unique identifier (e.g. IP, email, tenant_id)
 * maxRequests — max requests per window (default 10)
 * windowMs    — window size in milliseconds (default 60000 = 1 minute)
 */
function checkRateLimit({ key, maxRequests = 10, windowMs = 60000 }) {
  const now = Date.now();

  if (!windows[key] || now > windows[key].resetAt) {
    windows[key] = { count: 1, resetAt: now + windowMs };
    return { allowed: true };
  }

  windows[key].count++;

  if (windows[key].count > maxRequests) {
    return {
      allowed      : false,
      retryAfterMs : windows[key].resetAt - now,
    };
  }

  return { allowed: true };
}

/**
 * rateLimitResponse()
 * Returns a standard 429 response for use in Netlify functions.
 */
function rateLimitResponse(retryAfterMs) {
  const retryAfterSec = Math.ceil((retryAfterMs || 60000) / 1000);
  return {
    statusCode: 429,
    headers: {
      'Content-Type'               : 'application/json',
      'Retry-After'                : String(retryAfterSec),
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      error       : 'Too many requests. Please try again later.',
      retry_after : retryAfterSec,
    }),
  };
}

/**
 * getClientIP(event)
 * Best-effort extraction of client IP from Netlify event headers.
 */
function getClientIP(event) {
  const headers = event.headers || {};
  return headers['x-nf-client-connection-ip']
    || headers['x-forwarded-for']?.split(',')[0]?.trim()
    || headers['client-ip']
    || 'unknown';
}

module.exports = { checkRateLimit, rateLimitResponse, getClientIP };
