// netlify/functions/lib/auth.js
// Shared operator authentication helper.
// Drop this into your existing lib/ folder alongside your current auth utilities.
// If you already have requireOperatorContext() defined elsewhere, merge as needed.

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Validates the incoming request as an authenticated operator.
 * Reads the Bearer token from the Authorization header,
 * verifies it against Supabase auth, and confirms the user
 * has an entry in the operator_members table.
 *
 * Returns { operator, user } on success.
 * Returns { error, status } on failure.
 */
async function requireOperatorContext(event) {
  const authHeader =
    event.headers["authorization"] || event.headers["Authorization"] || "";

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!token) {
    return { error: "Missing authorization token", status: 401 };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Verify the JWT with Supabase
  const { data: userData, error: userError } =
    await supabase.auth.getUser(token);

  if (userError || !userData?.user) {
    return { error: "Invalid or expired token", status: 401 };
  }

  const user = userData.user;

  // Check operator_members table for this user
  const { data: member, error: memberError } = await supabase
    .from("operator_members")
    .select("user_id, tenant_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError || !member) {
    return { error: "User is not an operator", status: 403 };
  }

  return { operator: member, user };
}

module.exports = { requireOperatorContext };
