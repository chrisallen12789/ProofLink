"use strict";

const { expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");
const { signInUser } = require("../setup/test-helpers");

loadTestEnv();

function horizontalOverflowPx() {
  return Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
}

async function suppressOperatorTours(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("pl_tour_v1", "1");
    window.localStorage.setItem("prooflink_tour_completed_v2", "1");
  });
}

async function safeClick(locator, { timeout = 15000 } = {}) {
  await expect(locator).toBeVisible({ timeout });
  try {
    await locator.click({ timeout });
  } catch (_error) {
    await locator.click({ force: true, timeout: Math.min(timeout, 5000) });
  }
}

async function expectNoOverflow(page) {
  const overflow = await page.evaluate(horizontalOverflowPx);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function loginAsOperatorSession(page, email, password) {
  const auth = await signInUser(email, password);
  const session = auth?.session || null;
  const accessToken = session?.access_token || "";
  const refreshToken = session?.refresh_token || "";

  if (!accessToken || !refreshToken) {
    throw new Error("Unable to create a test operator session.");
  }

  await suppressOperatorTours(page);
  await page.goto("/operator/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.sb?.auth?.setSession, null, { timeout: 30000 });

  const setResult = await page.evaluate(async ({ accessToken: nextAccessToken, refreshToken: nextRefreshToken }) => {
    if (!window.sb?.auth?.setSession) {
      return { error: "Operator auth client unavailable." };
    }

    const { error } = await window.sb.auth.setSession({
      access_token: nextAccessToken,
      refresh_token: nextRefreshToken,
    });

    if (error) {
      return { error: error.message || String(error) };
    }

    const { data } = await window.sb.auth.getSession();
    return { hasSession: !!data?.session };
  }, { accessToken, refreshToken });

  if (setResult?.error) {
    throw new Error(setResult.error);
  }

  const waitForOperatorBoot = () => page.waitForFunction(() => {
    if (window.PROOFLINK_BOOT_READY === true) return true;
    const login = document.getElementById("viewLogin");
    return !!login && getComputedStyle(login).display === "none";
  }, null, { timeout: 45000 });

  const booted = await waitForOperatorBoot().then(() => true).catch(() => false);
  if (!booted) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForOperatorBoot();
  }

  await expect(page.locator("#viewLogin")).toBeHidden({ timeout: 30000 });
  await page.waitForFunction(() => window.PROOFLINK_BOOT_READY === true, null, { timeout: 45000 });
}

module.exports = {
  expectNoOverflow,
  loginAsOperatorSession,
  safeClick,
  suppressOperatorTours,
};
