const { app } = require("@azure/functions");
const { sanitize, renderEmail, sendEmail, ORDERS_TO } = require("./_mail");

app.http("order", {
  methods: ["POST", "OPTIONS"],
  authLevel: "function",
  handler: async (req, ctx) => {
    if (req.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders() };
    }

    let body;
    try { body = await req.json(); }
    catch { return { status: 400, headers: corsHeaders(), jsonBody: { ok:false, error:"Invalid JSON" } }; }

    const name = sanitize(body.name, 200);
    const email = sanitize(body.email, 320);
    const notes = sanitize(body.notes || body.message || "", 4000);
    const cartSummary = sanitize(body.cartSummary || body.cartSummaryField || "", 8000);

    if (!name || !email || !cartSummary) {
      return { status: 400, headers: corsHeaders(), jsonBody: { ok:false, error:"Missing name, email, or cart summary" } };
    }

    try {
      // 1) Customer confirmation
      const htmlCustomer = renderEmail("order", {
        subject: "Order request received",
        preheader: "We will confirm timing and details before baking.",
        name, cartSummary
      });

      await sendEmail({
        from: "orders@honesttocrust.com",
        to: email,
        subject: "Order request received",
        html: htmlCustomer,
        replyTo: "orders@honesttocrust.com"
      });

      // 2) Internal notification (orders inbox)
      const htmlInternal = renderEmail("internal", {
        subject: "[HTC] New order request",
        preheader: "New order request received.",
        kind: "order",
        name, email, cartSummary, message: notes
      });

      await sendEmail({
        from: "no-reply@honesttocrust.com",
        to: ORDERS_TO,
        subject: "[HTC] New order request",
        html: htmlInternal,
        replyTo: email
      });

      return { status: 200, headers: corsHeaders(), jsonBody: { ok:true } };
    } catch (e) {
      ctx.error(e);
      return { status: 500, headers: corsHeaders(), jsonBody: { ok:false, error:"Email send failed" } };
    }
  }
});

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-functions-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}
