const { app } = require("@azure/functions");
const { sanitize, renderEmail, sendEmail, MAIL_TO } = require("./_mail");

app.http("contact", {
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
    const subjectIn = sanitize(body.subject, 300);
    const message = sanitize(body.message, 4000);

    if (!name || !email || !message) {
      return { status: 400, headers: corsHeaders(), jsonBody: { ok:false, error:"Missing name, email, or message" } };
    }

    try {
      // 1) Customer confirmation
      const htmlCustomer = renderEmail("contact", {
        subject: "We got your message",
        preheader: "Thanks for reaching out — we will reply soon.",
        name, message
      });

      await sendEmail({
        from: "info@honesttocrust.com",
        to: email,
        subject: "We got your message",
        html: htmlCustomer,
        replyTo: "info@honesttocrust.com"
      });

      // 2) Internal notification
      const htmlInternal = renderEmail("internal", {
        subject: "[HTC] New contact form submission",
        preheader: "New contact submission received.",
        kind: "contact",
        name, email, subject: subjectIn, message
      });

      await sendEmail({
        from: "no-reply@honesttocrust.com",
        to: MAIL_TO,
        subject: "[HTC] New contact submission",
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
