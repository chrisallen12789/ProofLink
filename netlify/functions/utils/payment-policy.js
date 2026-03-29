'use strict';

function clean(value) {
  return String(value || '').trim();
}

function parseBps(value) {
  if (value == null) return null;
  const normalized = clean(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(10000, Math.round(parsed)));
}

function getDefaultApplicationFeeBps() {
  const configured = [
    process.env.PROOFLINK_DEFAULT_APPLICATION_FEE_BPS,
    process.env.DEFAULT_APPLICATION_FEE_BPS,
    process.env.APPLICATION_FEE_BPS,
  ];

  for (const candidate of configured) {
    const parsed = parseBps(candidate);
    if (parsed != null && parsed > 0) return parsed;
  }

  return 750;
}

function resolveApplicationFeeBps(...values) {
  for (const value of values) {
    const parsed = parseBps(value);
    if (parsed != null && parsed > 0) return parsed;
  }
  return getDefaultApplicationFeeBps();
}

function needsApplicationFeeBackfill(value) {
  const parsed = parseBps(value);
  return parsed == null || parsed <= 0;
}

module.exports = {
  getDefaultApplicationFeeBps,
  needsApplicationFeeBackfill,
  parseBps,
  resolveApplicationFeeBps,
};
