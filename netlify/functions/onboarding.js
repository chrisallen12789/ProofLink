'use strict';

const { respond } = require('./utils/auth');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');
const { submitOnboardingRequest } = require('./lib/public-onboarding');

function parseBody(event) {
  const contentType = String(
    event?.headers?.['content-type'] || event?.headers?.['Content-Type'] || ''
  ).toLowerCase();
  const raw = event.body || '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    const payload = {};
    for (const [key, value] of params.entries()) payload[key] = value;
    return payload;
  }

  return JSON.parse(raw || '{}');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, { ok: true });
  if (event.httpMethod !== 'POST') return respond(405, { ok: false, error: 'Method not allowed' });

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `onboard2:${ip}`, maxRequests: 5, windowMs: 600000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  let body;
  try {
    body = parseBody(event);
  } catch {
    return respond(400, { ok: false, error: 'Invalid JSON body' });
  }

  try {
    const result = await submitOnboardingRequest(body);
    return respond(201, result);
  } catch (err) {
    const response = { ok: false, error: err.message };
    if (err.fields) response.fields = err.fields;
    if (err.detail) response.detail = err.detail;
    return respond(err.statusCode || 500, response);
  }
};
