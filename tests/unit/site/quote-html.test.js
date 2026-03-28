"use strict";

const fs = require("fs");
const path = require("path");

describe("quote page html", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "quote.html"),
    "utf8"
  );

  test("uses more reassuring estimate approval language", () => {
    expect(source).toContain("Approve and continue");
    expect(source).toContain("Have a question before you approve?");
    expect(source).toContain("Waiting on your approval");
    expect(source).toContain("The business has been notified and will follow up with the next steps shortly.");
    expect(source).toContain('id="modalEstimateAmount"');
    expect(source).toContain('id="modalEstimateValidUntil"');
    expect(source).toContain('id="modalCustomerEmail"');
    expect(source).toContain("recipient_email_hint");
    expect(source).toContain("Confirm the email this estimate was sent to");
    expect(source).toContain("customer_email: String(emailInput.value || '').trim() || undefined");
  });

  test("does not carry mojibake into the estimate page", () => {
    expect(source).not.toContain("â");
    expect(source).not.toContain("Ã");
  });
});
