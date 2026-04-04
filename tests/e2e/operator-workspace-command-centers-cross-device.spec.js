"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");

loadTestEnv();

function horizontalOverflowPx() {
  return Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
}

async function suppressTours(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("pl_tour_v1", "1");
    window.localStorage.setItem("prooflink_tour_completed_v2", "1");
  });
}

async function expectNoOverflow(page) {
  const overflow = await page.evaluate(horizontalOverflowPx);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function settleSlowHydrovacTab(page, browserName, isMobile) {
  if (!isMobile && browserName === "webkit") {
    await page.waitForTimeout(15000);
  }
}

async function loginAsOperator(page, email, password) {
  await suppressTours(page);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/operator/");
    await page.locator("#loginForm").waitFor();
    await page.locator("#loginEmail").fill(email);
    await page.locator("#loginPassword").fill(password);
    await page.locator("#loginForm button[type='submit']").click();
    const booted = await page.waitForFunction(() => {
      if (window.PROOFLINK_BOOT_READY === true) return true;
      const login = document.getElementById("viewLogin");
      return !!login && getComputedStyle(login).display === "none";
    }, null, { timeout: 45000 }).then(() => true).catch(() => false);
    if (booted) {
      await expect(page.locator("#viewLogin")).toBeHidden({ timeout: 30000 });
      return;
    }
  }

  await expect(page.locator("#viewLogin")).toBeHidden({ timeout: 30000 });
  await page.waitForFunction(() => window.PROOFLINK_BOOT_READY === true, null, { timeout: 45000 });
}

async function loginAsTenantA(page) {
  await loginAsOperator(page, process.env.TEST_TENANT_A_ADMIN_EMAIL, process.env.TEST_TENANT_A_ADMIN_PASSWORD);
}

async function loginAsTenantB(page) {
  await loginAsOperator(page, process.env.TEST_TENANT_B_ADMIN_EMAIL, process.env.TEST_TENANT_B_ADMIN_PASSWORD);
}

async function openSidebarTab(page, tab, headingText, isMobile) {
  if (!isMobile) {
    await page.evaluate((targetTab) => {
      if (typeof window.switchTab === "function") {
        window.switchTab(targetTab);
      }
    }, tab);
    await page.waitForTimeout(750);
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

  await page.waitForFunction(
    (targetTab) => {
      const panel = document.querySelector(`[data-panel="${targetTab}"]`);
      return !!panel && !panel.classList.contains("hidden");
    },
    tab,
    { timeout: 15000 }
  );

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

  test("hydrovac facilities and manifests stay visible across devices", async ({ page, isMobile, browserName }) => {
    await loginAsTenantB(page);

    await openSidebarTab(page, "facilities", "Disposal Facilities", isMobile);
    await settleSlowHydrovacTab(page, browserName, isMobile);
    await expect(page.locator("#facilityStageStrip .record-hero")).toBeVisible();
    await expect(page.locator("#facilityActionBar .workspace-focus-card")).toBeVisible();
    await expect(page.locator("#hydrovacFacilitiesList .workspace-board")).toBeVisible();
    await expectNoOverflow(page);

    await openSidebarTab(page, "manifests", "Loads & Manifests", isMobile);
    await settleSlowHydrovacTab(page, browserName, isMobile);
    await expect(page.locator("#manifestStageStrip .record-hero")).toBeVisible();
    await expect(page.locator("#manifestActionBar .workspace-focus-card")).toBeVisible();
    await page.waitForFunction(() => {
      const list = document.getElementById("hydrovacManifestsList");
      const text = list?.textContent || "";
      return /Closeout lane|Needs field handoff|Ready to invoice|PLHV-/i.test(text);
    }, null, { timeout: 30000 });
    await expect(page.locator("#hydrovacManifestsList .workspace-board").first()).toBeVisible();
    await expect(page.locator("#hydrovacManifestsList")).toContainText(/Closeout lane|Needs field handoff|Ready to invoice/i);
    await expectNoOverflow(page);
  });

  test("hydrovac locates and compliance stay visible across devices", async ({ page, isMobile, browserName }) => {
    await loginAsTenantB(page);

    await openSidebarTab(page, "locates", "Locate Tickets", isMobile);
    await settleSlowHydrovacTab(page, browserName, isMobile);
    await expect(page.locator("#locateStageStrip .record-hero")).toBeVisible();
    await expect(page.locator("#locateActionBar .workspace-focus-card")).toBeVisible();
    await expect(page.locator("#hydrovacLocateList .workspace-board")).toBeVisible();
    await expectNoOverflow(page);

    await openSidebarTab(page, "compliance", "Compliance", isMobile);
    await settleSlowHydrovacTab(page, browserName, isMobile);
    await expect(page.locator("#complianceStageStrip .record-hero")).toBeVisible();
    await expect(page.locator("#permitStageStrip .record-hero")).toBeVisible();
    await expect(page.locator("#permitActionBar .workspace-focus-card")).toBeVisible();
    await expect(page.locator("#hydrovacPermitList .workspace-board")).toBeVisible();
    await expect(page.locator("#assetStageStrip .record-hero")).toBeVisible();
    await expect(page.locator("#assetActionBar .workspace-focus-card")).toBeVisible();
    await expect(page.locator("#hydrovacAssetList .workspace-board")).toBeVisible();
    await expect(page.locator("#hydrovacComplianceCoverage")).toContainText(/Closeout release blockers|Disposal workflow board/i);
    await expect(page.locator("#hydrovacComplianceUrgent")).toContainText(/Permit still open|Audit packet incomplete|Locate expired/i);
    await expectNoOverflow(page);
  });
});
