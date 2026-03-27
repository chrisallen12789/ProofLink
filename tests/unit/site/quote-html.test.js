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
  });

  test("does not carry mojibake into the estimate page", () => {
    expect(source).not.toContain("â");
    expect(source).not.toContain("Ã");
  });
});
