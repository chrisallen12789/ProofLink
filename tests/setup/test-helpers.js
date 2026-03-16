"use strict";

const { createClient } = require("@supabase/supabase-js");
const { assertRequiredEnv, loadTestEnv } = require("./env.test");
const { TENANTS } = require("../fixtures/tenants");
const { USERS, resolveUserConfig } = require("../fixtures/users");
const { ONBOARDING_FIXTURES } = require("../fixtures/onboarding");

loadTestEnv();

function createAdminClient() {
  assertRequiredEnv();
  return createClient(process.env.TEST_SUPABASE_URL, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function createAnonClient() {
  assertRequiredEnv();
  return createClient(process.env.TEST_SUPABASE_URL, process.env.TEST_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signInUser(email, password) {
  const client = createAnonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function getAccessToken(userConfig) {
  const resolved = resolveUserConfig(userConfig);
  const session = await signInUser(resolved.email, resolved.password);
  return session.session.access_token;
}

function buildEvent({ method = "GET", body, headers = {}, queryStringParameters } = {}) {
  return {
    httpMethod: method,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers,
    queryStringParameters: queryStringParameters || null,
  };
}

async function adminTableMaybeSingle(table, column, value) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from(table).select("*").eq(column, value).maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchTenantBySlug(slug) {
  return adminTableMaybeSingle("tenants", "slug", slug);
}

async function fetchOnboardingBySlug(slug) {
  return adminTableMaybeSingle("tenant_onboarding_requests", "business_slug", slug);
}

async function authenticatedClientFor(userConfig) {
  const resolved = resolveUserConfig(userConfig);
  const session = await signInUser(resolved.email, resolved.password);
  const client = createClient(process.env.TEST_SUPABASE_URL, process.env.TEST_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${session.session.access_token}`,
      },
    },
  });

  return { client, session, user: session.user };
}

module.exports = {
  ONBOARDING_FIXTURES,
  TENANTS,
  USERS,
  adminTableMaybeSingle,
  authenticatedClientFor,
  buildEvent,
  createAdminClient,
  createAnonClient,
  fetchOnboardingBySlug,
  fetchTenantBySlug,
  getAccessToken,
  signInUser,
};
