const { EmailClient } = require("@azure/communication-email");
const Handlebars = require("handlebars");
const sanitizeHtml = require("sanitize-html");
const fs = require("fs");
const path = require("path");

const ACS_CONNECTION_STRING = process.env.ACS_CONNECTION_STRING;
const SITE_URL = (process.env.PUBLIC_SITE_URL || "https://honesttocrust.com").replace(/\/$/, "");
const MAIL_TO = process.env.MAIL_TO || "info@honesttocrust.com";
const ORDERS_TO = process.env.ORDERS_TO || "orders@honesttocrust.com";

function sanitize(input, maxLen = 4000) {
  if (typeof input !== "string") return "";
  return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} }).trim().slice(0, maxLen);
}

function loadTemplates() {
  const baseDir = path.join(__dirname, "..", "..", "email-templates");
  const layout = fs.readFileSync(path.join(baseDir, "layouts", "base.html"), "utf8");
  const header = fs.readFileSync(path.join(baseDir, "partials", "header.html"), "utf8");
  const signature = fs.readFileSync(path.join(baseDir, "partials", "signature.html"), "utf8");
  const footer = fs.readFileSync(path.join(baseDir, "partials", "footer.html"), "utf8");

  Handlebars.registerPartial("header", header);
  Handlebars.registerPartial("signature", signature);
  Handlebars.registerPartial("footer", footer);

  return {
    render: Handlebars.compile(layout),
    bodies: {
      contact: fs.readFileSync(path.join(baseDir, "contact.html"), "utf8"),
      order: fs.readFileSync(path.join(baseDir, "order.html"), "utf8"),
      internal: fs.readFileSync(path.join(baseDir, "internal.html"), "utf8")
    }
  };
}

const TPL = loadTemplates();

function renderEmail(bodyKey, data) {
  Handlebars.registerPartial("body", TPL.bodies[bodyKey]);
  return TPL.render({ ...data, siteUrl: SITE_URL, year: new Date().getFullYear() });
}

async function sendEmail({ from, to, subject, html, replyTo }) {
  if (!ACS_CONNECTION_STRING) throw new Error("ACS_CONNECTION_STRING is missing");
  const client = new EmailClient(ACS_CONNECTION_STRING);

  const message = {
    senderAddress: from,
    content: { subject, html, plainText: subject + "\n\n" + (dataToPlain(html)) },
    recipients: { to: Array.isArray(to) ? to.map(a => ({ address: a })) : [{ address: to }] },
    replyTo: replyTo ? [{ address: replyTo }] : undefined
  };

  const poller = await client.beginSend(message);
  return await poller.pollUntilDone();
}

// very basic html-to-text (good enough for receipts)
function dataToPlain(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { sanitize, renderEmail, sendEmail, SITE_URL, MAIL_TO, ORDERS_TO };
