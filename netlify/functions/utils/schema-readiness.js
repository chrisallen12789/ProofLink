'use strict';

function clean(value) {
  return String(value || '').trim();
}

function extractErrorCode(error) {
  const directCode = clean(error?.code || error?.error?.code).toUpperCase();
  if (directCode) return directCode;

  const message = clean(error?.message || error?.error?.message);
  if (!message) return '';

  try {
    const parsed = JSON.parse(message);
    return clean(parsed?.code).toUpperCase();
  } catch {
    const match = message.match(/"code"\s*:\s*"([^"]+)"/i);
    return clean(match && match[1]).toUpperCase();
  }
}

function extractErrorMessage(error) {
  return clean(error?.message || error?.error?.message);
}

function isMissingSchemaError(error, matchers = []) {
  const code = extractErrorCode(error);
  const message = extractErrorMessage(error).toLowerCase();

  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(code)) return true;
  if (message.includes('schema cache')) return true;
  if (message.includes('could not find the table')) return true;
  if (message.includes('relation') && message.includes('does not exist')) return true;

  return matchers.some((matcher) => message.includes(String(matcher || '').toLowerCase()));
}

module.exports = {
  extractErrorCode,
  extractErrorMessage,
  isMissingSchemaError,
};
