"use strict";

const fs = require("fs");
const path = require("path");

describe("booking page html", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "book.html"),
    "utf8"
  );

  test("uses clearer appointment-request guidance", () => {
    expect(source).toContain("<title>Request an appointment</title>");
    expect(source).toContain("we will confirm the final appointment shortly");
    expect(source).toContain("Send appointment request");
    expect(source).toContain("This form keeps things simple.");
    expect(source).toContain("Morning (8am-12pm)");
  });

  test("does not carry mojibake into the booking page", () => {
    expect(source).not.toContain("â");
    expect(source).not.toContain("Ã");
  });
});
