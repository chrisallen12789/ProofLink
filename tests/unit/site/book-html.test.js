"use strict";

const fs = require("fs");
const path = require("path");

describe("booking page html", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "book.html"),
    "utf8"
  );

  test("loads the richer scheduler experience", () => {
    expect(source).toContain("<title>Request an appointment</title>");
    expect(source).toContain("Daily</button>");
    expect(source).toContain("Weekly</button>");
    expect(source).toContain("Monthly</button>");
    expect(source).toContain("Yearly</button>");
    expect(source).toContain("Send appointment request");
    expect(source).toContain("book.css");
    expect(source).toContain("book.js");
    expect(source).toContain("Morning (8am-12pm)");
    expect(source).toContain("Suggested starting times");
    expect(source).toContain("Range-based availability");
  });

  test("does not carry mojibake into the booking page", () => {
    expect(source).not.toContain("â");
    expect(source).not.toContain("Ã");
  });
});
