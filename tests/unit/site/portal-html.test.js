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

  test("does not carry mojibake into the customer portal", () => {
    expect(source).not.toContain("â");
    expect(source).not.toContain("Ã");
    expect(source).not.toContain("LoadingÃ");
  });
});
