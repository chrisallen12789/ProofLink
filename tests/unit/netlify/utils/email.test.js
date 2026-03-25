"use strict";

const path = require("path");

describe("netlify/functions/utils/email", () => {
  const emailUtilsPath = path.resolve(process.cwd(), "netlify/functions/utils/email.js");

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:8888";
    process.env.SITE_URL = "http://127.0.0.1:8888";
    process.env.URL = "http://127.0.0.1:8888";
    process.env.RESEND_API_KEY = "resend_pltest";
    process.env.ALLOW_LOCAL_EMAIL_SKIP = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("missing RESEND_API_KEY fails closed outside explicit local email mode", async () => {
    process.env.PUBLIC_SITE_URL = "https://app.prooflink.test";
    process.env.SITE_URL = "https://app.prooflink.test";
    process.env.URL = "https://app.prooflink.test";
    process.env.RESEND_API_KEY = "";

    const { sendEmail } = require(emailUtilsPath);

    await expect(
      sendEmail({
        to: "ops@example.com",
        subject: "ProofLink config test",
        html: "<p>Hello</p>",
      })
    ).rejects.toMatchObject({
      code: "configuration_error",
      statusCode: 503,
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("explicit local email skip remains controlled", async () => {
    process.env.RESEND_API_KEY = "";
    process.env.ALLOW_LOCAL_EMAIL_SKIP = "true";

    const { sendEmail } = require(emailUtilsPath);
    const result = await sendEmail({
      to: "ops@example.com",
      subject: "ProofLink local skip",
      html: "<p>Hello</p>",
    });

    expect(result).toEqual({ skipped: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("customer-facing templates use business branding instead of application footer copy", async () => {
    const { templates } = require(emailUtilsPath);

    const email = templates.quoteReady({
      customer_name: "Chris",
      customer_email: "chris@example.com",
      business_name: "Benkari Vacs",
      title: "Hydrovac estimate",
      amount_cents: 125000,
      quote_url: "https://example.com/quote",
    });

    expect(email.html).toContain("<title>Benkari Vacs</title>");
    expect(email.html).toContain("Benkari Vacs");
    expect(email.html).toContain("Reply to this email if you need anything.");
    expect(email.html).not.toContain("You received this because you applied to join ProofLink.");
  });

  test("owner onboarding emails use password setup language instead of dashboard or store jargon", async () => {
    const { templates } = require(emailUtilsPath);

    const email = templates.provisioned({
      owner_name: "Chris",
      owner_email: "chris@example.com",
      business_name: "Benkari Vacs",
      login_url: "https://example.com/set-password",
      store_slug: "benkari-vacs",
      business_type: "hydrovac",
    });

    expect(email.subject).toContain("account is ready");
    expect(email.html).toContain("Set my password");
    expect(email.html).toContain("Sign-in page");
    expect(email.html).toContain("Your website");
    expect(email.html).not.toContain("dashboard");
    expect(email.html).not.toContain("Your store is live");
  });
});
