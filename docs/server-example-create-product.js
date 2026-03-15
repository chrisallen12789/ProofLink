const { createClient } = require("@supabase/supabase-js");
const {
  enforceLimit,
  enforcementResponse
} = require("./lib/plan-enforcement");

exports.handler = async function(event) {
  // Example only. Replace with your real auth + tenant resolution.
  const tenant = { id: "tenant_123", prooflink_plan_key: "starter" };

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { count, error } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id);

  if (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: error.message })
    };
  }

  if (!enforceLimit("products", count, tenant)) {
    return {
      statusCode: 403,
      body: JSON.stringify(enforcementResponse("products", count, tenant))
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true })
  };
};
