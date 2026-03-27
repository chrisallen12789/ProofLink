"use strict";

const fs = require("fs");
const path = require("path");

describe("customer portal html", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "portal.html"),
    "utf8"
  );

  test("uses clearer customer-account guidance", () => {
    expect(source).toContain("<title>Customer account</title>");
    expect(source).toContain("Use the email you book with");
    expect(source).toContain("See my account");
    expect(source).toContain("Message us");
    expect(source).toContain("Schedule another appointment");
    expect(source).toContain("Use another email");
  });

  test("only shows a review link when the portal receives a real estimate review URL", () => {
    expect(source).toContain("var reviewUrl = q.review_url || '';");
    expect(source).toContain("Review estimate");
    expect(source).not.toContain('href="/quote.html?token=');
  });

  test("uses delegated payment buttons and checkout return guidance", () => {
    expect(source).toContain('data-action="pay-now"');
    expect(source).not.toContain('onclick="handlePayNow(');
    expect(source).toContain("checkoutState === 'success'");
    expect(source).toContain("checkoutState === 'cancel'");
    expect(source).toContain("Your payment for ");
    expect(source).toContain("No payment was made for ");
    expect(source).toContain("if (tenantId && prefill && checkoutState)");
  });

  test("does not carry mojibake into the customer portal", () => {
    expect(source).not.toContain("Ã¢");
    expect(source).not.toContain("Ãƒ");
    expect(source).not.toContain("LoadingÃƒ");
  });
});
