"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");
const { expectNoOverflow, loginAsOperatorSession } = require("./operator-test-helpers");

loadTestEnv();

async function settleSlowHydrovacTab(page, browserName, isMobile) {
  if (!isMobile && browserName === "webkit") {
    await page.waitForTimeout(15000);
  }
}

async function loginAsOperator(page, email, password) {
  await loginAsOperatorSession(page, email, password);
}

async function loginAsTenantA(page) {
  await loginAsOperator(page, process.env.TEST_TENANT_A_ADMIN_EMAIL, process.env.TEST_TENANT_A_ADMIN_PASSWORD);
}

async function loginAsTenantB(page) {
  await loginAsOperator(page, process.env.TEST_TENANT_B_ADMIN_EMAIL, process.env.TEST_TENANT_B_ADMIN_PASSWORD);
}

async function openOperatorPanelByHash(page, tab, timeout = 60000) {
  await page.goto(`/operator/#${tab}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction((targetTab) => {
    const panel = document.querySelector(`[data-panel="${targetTab}"]`);
    return window.PROOFLINK_BOOT_READY === true
      && !!panel
      && !panel.classList.contains("hidden")
      && getComputedStyle(panel).display !== "none";
  }, tab, { timeout });
}

async function _ensureHydrovacPanelVisible(page, { tab, selector, refreshFunction, timeout = 60000 }) {
  const target = page.locator(selector);
  const visible = await target.isVisible().catch(() => false);
  if (visible) return;

  await openOperatorPanelByHash(page, tab, timeout);
  if (refreshFunction) {
    await page.evaluate(async (functionName) => {
      const candidate = window[functionName];
      if (typeof candidate === "function") {
        await candidate();
      }
    }, refreshFunction);
  }
  await expect(target).toBeVisible({ timeout });
}

async function expectPanelText(page, selector, pattern, timeout = 60000) {
  const source = pattern instanceof RegExp ? pattern.source : String(pattern || "");
  const flags = pattern instanceof RegExp ? pattern.flags : "i";
  const matcher = new RegExp(source, flags);
  await expect.poll(async () => page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    return String(target?.textContent || "").replace(/\s+/g, " ").trim();
  }, selector), {
    timeout,
    message: `Expected ${selector} to match ${matcher}`,
  }).toMatch(matcher);
}

async function _activateDesktopPanel(page, tab, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let lastState = null;

  while (Date.now() < deadline) {
    lastState = await page.evaluate((targetTab) => {
      const panel = document.querySelector(`[data-panel="${targetTab}"]`);
      const isVisible = !!panel
        && !panel.classList.contains("hidden")
        && getComputedStyle(panel).display !== "none";
      if (!isVisible) {
        if (typeof window.switchTab === "function") {
          window.switchTab(targetTab, { force: true });
        }
        const sidebarTab = document.querySelector(`.sidebar .tab[data-tab="${targetTab}"]`);
        if (sidebarTab instanceof HTMLElement) {
          sidebarTab.click();
        }
      }
      return {
        visible: isVisible,
        targetTab,
      };
    }, tab);

    if (lastState?.visible) return lastState;
    await page.waitForTimeout(3000);
  }

  throw new Error(`Panel "${tab}" did not become visible in time: ${JSON.stringify(lastState || {})}`);
}

async function openSidebarTab(page, tab, headingText, isMobile) {
  async function waitForPanelVisible() {
    await page.waitForFunction(
      (targetTab) => {
        const panel = document.querySelector(`[data-panel="${targetTab}"]`);
        return !!panel
          && !panel.classList.contains("hidden")
          && getComputedStyle(panel).display !== "none";
      },
      tab,
      { timeout: 15000 }
    );
  }

  if (!isMobile) {
    const sidebarTab = page.locator(`.sidebar .tab[data-tab="${tab}"]`).first();
    let desktopPanelVisible = false;

    if ((await sidebarTab.count()) > 0) {
      await expect(sidebarTab).toBeVisible({ timeout: 10000 });
      const clickedSidebarTab = await sidebarTab.click({ timeout: 5000 }).then(() => true).catch(() => false);
      if (clickedSidebarTab) {
        desktopPanelVisible = await waitForPanelVisible().then(() => true).catch(() => false);
      }
    }

    if (!desktopPanelVisible) {
      await page.evaluate((targetTab) => {
        if (typeof window.switchTab === "function") {
          window.switchTab(targetTab, { force: true });
        }
      }, tab);
      await waitForPanelVisible();
    }

    await expectNoOverflow(page);
    return;
  }

  const mobileHydrovacQuickNav = page.locator(`#operatorHydrovacQuickNav [data-hydrovac-mobile-tab="${tab}"]`);
  const useHydrovacQuickNav = ["facilities", "manifests", "locates", "compliance"].includes(tab)
    && (await mobileHydrovacQuickNav.count()) > 0;

  if (useHydrovacQuickNav) {
    await expect(mobileHydrovacQuickNav.first()).toBeVisible();
    await mobileHydrovacQuickNav.first().evaluate((button) => button.click());
  } else {
    const sidebarTab = page.locator(`.sidebar .tab[data-tab="${tab}"]`).first();
    if (await sidebarTab.isVisible()) {
      await sidebarTab.evaluate((button) => button.click());
    } else {
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.locator("#mbnMenuBtn").evaluate((button) => button.click());
      await page.waitForFunction(
        () => document.body.classList.contains("sidebar-overlay-open")
          && document.querySelector(".sidebar")?.classList.contains("mobile-open"),
        null,
        { timeout: 5000 }
      );
      await sidebarTab.evaluate((button) => button.click());
    }
  }

  await waitForPanelVisible();

  await expectNoOverflow(page);
}

test.describe("operator workspace command centers cross-device", () => {
  test.setTimeout(420000);

  test("workflow shells stay usable across devices", async ({ page, isMobile }) => {
    await loginAsTenantA(page);

    await openSidebarTab(page, "orders", /^(Work|Orders)$/i, isMobile);
    await expect(page.locator("#orderDetailWrap .workspace-command-center")).toBeVisible();
    await expect(page.locator("#orderDetailWrap .workspace-signal-band")).toBeVisible();
    await expectNoOverflow(page);

    await openSidebarTab(page, "bids", /^(Walkthrough Bids|Bids)$/i, isMobile);
    await expect(page.locator('[data-panel="bids"]:not(.hidden) .workflow-shell--bids')).toBeVisible();
    await expect(page.locator("#bidGuideFlow")).toContainText(/guided workflow|guided steps complete|Start a bid/i);
    await expect(page.locator("#bidsList")).toBeVisible();
    await expectNoOverflow(page);

    await openSidebarTab(page, "jobs", "Jobs", isMobile);
    await expect(page.locator("#jobsList")).toBeVisible();
    await expect(page.locator("#jobsList")).toContainText(/No active jobs yet|Job/i);
    await expectNoOverflow(page);

    await openSidebarTab(page, "bookings", /^(Calendar|Bookings)$/i, isMobile);
    await expect(page.locator("#bookingsOverviewWrap")).toBeVisible();
    await expect(page.locator('[data-panel="bookings"]:not(.hidden) .workflow-shell--bookings')).toBeVisible();
    await expect(page.locator("#dispatchStageStrip .record-hero")).toBeVisible();
    await expect(page.locator("#dispatchActionBar .workspace-focus-card")).toBeVisible();
    await expect(page.locator("#dispatchBoard .workspace-board")).toBeVisible();
    await expectNoOverflow(page);

    await openSidebarTab(page, "money", /^(Money|Insights)$/i, isMobile);
    await expect(page.locator('[data-panel="money"]:not(.hidden) .panel-head h2').first()).toHaveText(/^(Money|Insights)$/i);
    await expect(page.locator("#moneyWrap .workspace-command-center")).toBeVisible();
    await expect(page.locator("#moneyWrap .record-hero")).toContainText(/Money command center|Keep cash and margin moving together|Overdue balances need attention first/i);
    await expect(page.locator("#moneyWrap .workspace-focus-card")).toBeVisible();
    await expectNoOverflow(page);
  });

  test("hydrovac facilities stay visible across devices", async ({ page, isMobile, browserName }) => {
    await loginAsTenantB(page);
    await openOperatorPanelByHash(page, "facilities", browserName === "webkit" ? 90000 : 60000);
    await settleSlowHydrovacTab(page, browserName, isMobile);
    const hydrovacTimeout = browserName === "webkit" && !isMobile ? 90000 : 60000;
    await expect(page.locator("#facilityStageStrip .record-hero")).toBeVisible({ timeout: hydrovacTimeout });
  });

  test("hydrovac locates stay visible across devices", async ({ page, isMobile, browserName }) => {
    await loginAsTenantB(page);
    await openOperatorPanelByHash(page, "locates", browserName === "webkit" ? 90000 : 60000);
    await settleSlowHydrovacTab(page, browserName, isMobile);
    const hydrovacTimeout = browserName === "webkit" && !isMobile ? 90000 : 60000;
    await expect(page.locator("#locateStageStrip .record-hero")).toBeVisible({ timeout: hydrovacTimeout });
  });

  test("hydrovac compliance stay visible across devices", async ({ page, isMobile, browserName }) => {
    await loginAsTenantB(page);
    await openOperatorPanelByHash(page, "compliance", browserName === "webkit" ? 90000 : 60000);
    await settleSlowHydrovacTab(page, browserName, isMobile);
    const hydrovacTimeout = browserName === "webkit" && !isMobile ? 90000 : 60000;
    await expect(page.locator("#complianceStageStrip .record-hero")).toBeVisible({ timeout: hydrovacTimeout });
    await expect(page.locator("#permitStageStrip .record-hero")).toBeVisible({ timeout: hydrovacTimeout });
    await expect(page.locator("#assetStageStrip .record-hero")).toBeVisible({ timeout: hydrovacTimeout });
    await expectPanelText(page, "#hydrovacPermitList", /Permit watch|Permit still open|No permits logged|No confined-space permits logged yet|Entry board/i, hydrovacTimeout);
    await expectPanelText(page, "#hydrovacAssetList", /Asset watch|No asset records logged|No infrastructure assets saved yet|Asset board|Infrastructure/i, hydrovacTimeout);
    await expectPanelText(page, "#hydrovacComplianceCoverage", /Closeout release blockers|Disposal workflow board/i, hydrovacTimeout);
    await expectPanelText(page, "#hydrovacComplianceUrgent", /Permit still open|Audit packet incomplete|Locate expired|No urgent compliance issues are showing right now/i, hydrovacTimeout);
  });

  test("hydrovac manifests stay visible across devices", async ({ page, isMobile, browserName }) => {
    await loginAsTenantB(page);
    await openOperatorPanelByHash(page, "manifests", browserName === "webkit" ? 90000 : 60000);
    await settleSlowHydrovacTab(page, browserName, isMobile);
    const hydrovacTimeout = browserName === "webkit" && !isMobile ? 90000 : 60000;
    await expect(page.locator('[data-panel="manifests"]:not(.hidden) .panel-head h2')).toHaveText(/Loads & Manifests/i, { timeout: hydrovacTimeout });
    await expect(page.locator("#btnRefreshManifests")).toBeVisible({ timeout: hydrovacTimeout });
  });
});
