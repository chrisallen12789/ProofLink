"use strict";

const fs = require("fs");
const path = require("path");

describe("cart source", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "cart.js"),
    "utf8"
  );

  test("keeps an in-memory fallback when localStorage is unavailable", () => {
    expect(source).toContain("let MEMORY_CART_STATE = { items: [] };");
    expect(source).toContain("localStorage.getItem(STORAGE_KEY)");
    expect(source).toContain("localStorage.setItem(STORAGE_KEY, JSON.stringify({ items }))");
    expect(source).toContain("catch (_) {");
    expect(source).toContain("MEMORY_CART_STATE = { items };");
  });
});
