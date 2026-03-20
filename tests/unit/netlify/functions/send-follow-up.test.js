"use strict";

const path = require("path");

describe("netlify/functions/send-follow-up helpers", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/send-follow-up.js");
  const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
  const emailPath = path.resolve(process.cwd(), "netlify/functions/utils/email.js");

  function loadHelpers() {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
    delete require.cache[emailPath];

    const auth = require(authPath);
    auth.requireOperatorContext = vi.fn();
    auth.respond = (statusCode, body) => ({
      statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const email = require(emailPath);
    email.sendEmail = vi.fn();

    return require(handlerPath).__test;
  }

  test("cleanUrl keeps only http and https links", () => {
    const { cleanUrl } = loadHelpers();
    expect(cleanUrl("https://example.com/review")).toBe("https://example.com/review");
    expect(cleanUrl("http://example.com/review")).toBe("http://example.com/review");
    expect(cleanUrl("javascript:alert(1)")).toBe("");
    expect(cleanUrl("notaurl")).toBe("");
  });

  test("textToHtml includes a CTA button when a valid link is provided", () => {
    const { textToHtml } = loadHelpers();
    const html = textToHtml("Thanks for the opportunity.", "ProofLink", {
      ctaLabel: "Leave a Google review",
      ctaUrl: "https://example.com/review",
    });

    expect(html).toContain("Leave a Google review");
    expect(html).toContain("https://example.com/review");
    expect(html).toContain("If the button does not open");
  });

  test("textToHtml skips CTA markup when the link is invalid", () => {
    const { textToHtml } = loadHelpers();
    const html = textToHtml("Thanks for the opportunity.", "ProofLink", {
      ctaLabel: "Leave a Google review",
      ctaUrl: "javascript:alert(1)",
    });

    expect(html).not.toContain("If the button does not open");
    expect(html).not.toContain("Leave a Google review");
  });
});
