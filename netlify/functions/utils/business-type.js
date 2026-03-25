"use strict";

const BUSINESS_TYPE_ALIASES = {
  contractor_remodeling: "contractor",
  general_service: "service_business",
  service: "service_business",
  landscape: "landscaping",
  lawn_care: "landscaping",
  vactor: "hydrovac",
};

function clean(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeBusinessTypeKey(value) {
  const key = clean(value);
  if (!key) return "";
  return BUSINESS_TYPE_ALIASES[key] || key;
}

module.exports = {
  BUSINESS_TYPE_ALIASES,
  normalizeBusinessTypeKey,
};
