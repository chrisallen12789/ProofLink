"use strict";

const fs = require("fs");
const path = require("path");

describe("quote page html", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "quote.html"),
    "utf8"
  );

  test("uses current proposal approval language and email verification hooks", () => {
    expect(source).toContain("Approve proposal");
    expect(source).toContain("Questions before you approve?");
    expect(source).toContain("Approve this proposal?");
    expect(source).toContain("The business has been notified and will follow up with the next steps shortly.");
    expect(source).toContain('id="modalProposalAmount"');
    expect(source).toContain('id="modalProposalValidUntil"');
    expect(source).toContain('id="modalCustomerEmail"');
    expect(source).toContain("recipient_email_hint");
    expect(source).toContain("Confirm the email address this proposal was sent to");
    expect(source).toContain("customer_email: String(emailInput.value || '').trim() || undefined");
  });

  test("does not carry mojibake into the estimate page", () => {
    expect(source).not.toContain("â");
    expect(source).not.toContain("Ã");
  });
});
