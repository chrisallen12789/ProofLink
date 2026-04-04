"use strict";

const { test, expect } = require("@playwright/test");

function horizontalOverflowPx() {
  return Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
}

async function expectNoOverflow(page) {
  const overflow = await page.evaluate(horizontalOverflowPx);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function gridTrackCount(locator) {
  return locator.evaluate((node) => {
    const tracks = getComputedStyle(node).gridTemplateColumns
      .split(/\s+/)
      .filter(Boolean)
      .filter((value) => value !== "/");
    return tracks.length;
  });
}

test.describe("operator UI guide cross-device", () => {
  test("workspace shell guide stays readable on desktop and phone widths", async ({ page, isMobile }) => {
    await page.goto("/operator/operator-ui-guide.html");

    await expect(page.getByRole("heading", { name: /use the customer command center as the visual system/i })).toBeVisible();
    await expect(page.locator(".workspace-command-center")).toBeVisible();
    await expect(page.locator(".workspace-focus-card")).toBeVisible();
    await expect(page.locator(".workspace-board")).toBeVisible();
    await expectNoOverflow(page);

    const topTracks = await gridTrackCount(page.locator(".workspace-command-center__top").first());
    const boardTracks = await gridTrackCount(page.locator(".workspace-board__grid").first());
    const signalTracks = await gridTrackCount(page.locator(".workspace-signal-band").first());

    if (isMobile) {
      expect(topTracks).toBe(1);
      expect(boardTracks).toBe(1);
      expect(signalTracks).toBe(1);
    } else {
      expect(topTracks).toBeGreaterThan(1);
      expect(boardTracks).toBeGreaterThan(1);
      expect(signalTracks).toBeGreaterThan(1);
    }
  });
});
