"use strict";

const fs = require("fs");
const path = require("path");

describe("forms source", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "forms.js"),
    "utf8"
  );

  test("keeps spam protection manual and validates cart before field cleanup work", () => {
    expect(source).not.toContain("window.HTC_EMAIL_API_KEY");
    expect(source).toContain("ensureTurnstileToken(form, raw)");
    expect(source).toContain("Spam protection is still loading. Please wait a moment, then try again.");
    expect(source).toContain("Please enter a valid 5-digit ZIP code.");
    expect(source).toContain("We could not send an email confirmation just now");
  });
});
