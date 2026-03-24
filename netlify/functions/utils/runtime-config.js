'use strict';

function clean(value) {
  return String(value || '').trim();
}

function isLocalUrl(value) {
  const url = clean(value).toLowerCase();
  return (
    url.startsWith('http://127.0.0.1') ||
    url.startsWith('http://localhost') ||
    url.startsWith('https://127.0.0.1') ||
    url.startsWith('https://localhost')
  );
}

function isExplicitlyEnabled(name) {
  return clean(process.env[name]).toLowerCase() === 'true';
}

function configurationError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = 'configuration_error';
  return error;
}

function getConfiguredSiteUrl() {
  const explicitSiteUrl = clean(process.env.PUBLIC_SITE_URL || process.env.SITE_URL);
  if (explicitSiteUrl) {
    return explicitSiteUrl.replace(/\/+$/, '');
  }

  // Netlify automatically sets URL (production) and DEPLOY_PRIME_URL (branch deploys)
  const netlifyUrl = clean(process.env.URL || process.env.DEPLOY_PRIME_URL);
  if (netlifyUrl) {
    return netlifyUrl.replace(/\/+$/, '');
  }

  throw configurationError('SITE_URL or PUBLIC_SITE_URL is not configured.');
}

function localEmailSkipEnabled() {
  try {
    return isExplicitlyEnabled('ALLOW_LOCAL_EMAIL_SKIP') && isLocalUrl(getConfiguredSiteUrl());
  } catch {
    return false;
  }
}

function getRequiredResendApiKey() {
  const apiKey = clean(process.env.RESEND_API_KEY);
  if (apiKey) return apiKey;
  if (localEmailSkipEnabled()) return '';
  throw configurationError('RESEND_API_KEY is not configured.');
}

module.exports = {
  configurationError,
  getConfiguredSiteUrl,
  getRequiredResendApiKey,
  isLocalUrl,
  localEmailSkipEnabled,
};
