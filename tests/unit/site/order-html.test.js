"use strict";

const fs = require("fs");
const path = require("path");

describe("order page html", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "order.html"),
    "utf8"
  );

  test("guards delivery ZIP and empty-cart accessibility states", () => {
    expect(source).toContain('id="orderDeliveryZip"');
    expect(source).toContain('pattern="[0-9]{5}"');
    expect(source).toContain('title="Enter a 5-digit ZIP code"');
    expect(source).toContain('id="cartEmpty" class="muted" style="display:none;" tabindex="-1"');
  });
});
