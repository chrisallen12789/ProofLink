'use strict';

const { respond } = require('./utils/auth');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');
const { submitOnboardingRequest } = require('./lib/public-onboarding');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, {});
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `onboard:${ip}`, maxRequests: 5, windowMs: 600000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  try {
    const result = await submitOnboardingRequest(body);
    return respond(201, result);
  } catch (err) {
    const response = { error: err.message };
    if (err.fields) response.fields = err.fields;
    if (err.detail) response.detail = err.detail;
    return respond(err.statusCode || 500, response);
  }
};
