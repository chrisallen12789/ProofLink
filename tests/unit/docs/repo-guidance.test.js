"use strict";

const fs = require("fs");
const path = require("path");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("repo guidance", () => {
  test("README documents separate Stripe webhook endpoints", () => {
    const readme = readRepoFile("README.md");

    expect(readme).toContain("/.netlify/functions/stripe-webhook");
    expect(readme).toContain("/.netlify/functions/stripe-billing-webhook");
  });

  test("architecture docs reference the prooflink storefront runtime", () => {
    const docs = [readRepoFile("AGENTS.md"), readRepoFile("PROOFLINK_MASTER_SPEC.md")];

    docs.forEach((doc) => {
      expect(doc).toContain("prooflink.config.js");
      expect(doc).toContain("prooflink.core.js");
      expect(doc).toContain("prooflink.tenant.js");
      expect(doc).not.toContain("cottagelink.config.js");
      expect(doc).not.toContain("cottagelink.core.js");
      expect(doc).not.toContain("cottagelink.tenant.js");
    });
  });

  test("spec and agent guide describe the current storefront and booking contracts", () => {
    const agents = readRepoFile("AGENTS.md");
    const spec = readRepoFile("PROOFLINK_MASTER_SPEC.md");

    expect(agents).toContain("Creates public bookings when no Bearer token is supplied");
    expect(spec).toContain("PROOFLINK_CONFIG.storefront.cart.storageKey");
    expect(spec).not.toContain("COTTAGELINK_CONFIG");
  });

  test("legacy cottagelink runtime files are not present", () => {
    [
      "cottagelink.config.js",
      "cottagelink.core.js",
      "cottagelink.tenant.js",
    ].forEach((relativePath) => {
      expect(fs.existsSync(path.resolve(process.cwd(), relativePath))).toBe(false);
    });
  });
});
