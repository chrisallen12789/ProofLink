"use strict";

const fs = require("fs");
const path = require("path");

describe("operator mobile nav source", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-mobile-nav.js"),
    "utf8"
  );

  test("keeps the mobile menu button state in sync with the drawer", () => {
    expect(source).toContain("function syncMenuButton(isOpen) {");
    expect(source).toContain("menuButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');");
    expect(source).toContain("syncMenuButton(true);");
    expect(source).toContain("syncMenuButton(false);");
  });

  test("opens the mobile drawer without extra scroll choreography", () => {
    expect(source).toContain("function openSidebar() {");
    expect(source).not.toContain("function revealSidebarFocus() {");
    expect(source).not.toContain("scrollIntoView");
  });

  test("closes the mobile drawer after switchTab resolves instead of during the tap", () => {
    expect(source).not.toContain("window.setTimeout(closeSidebar, 0);");
    expect(source).toContain("if (result !== false && document.body.classList.contains('sidebar-overlay-open')) closeSidebar();");
  });
});
