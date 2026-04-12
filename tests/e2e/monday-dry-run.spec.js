"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");
const { createAdminClient } = require("../setup/test-helpers");
const { createBrowserAudit, loginAsCrew, loginAsOperator } = require("./browser-audit-helpers");

loadTestEnv();

async function getSeededCrewJob() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("jobs")
    .select("id, title, scheduled_date, status")
    .eq("work_order_number", "PL-WO-HV-4403")
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    throw new Error("Seeded Monday dry-run crew job PL-WO-HV-4403 was not found.");
  }
  return data;
}

test.describe("monday dry run", () => {
  test.setTimeout(180000);

  test("operator can open the seeded crew job and launch the crew handoff URL", async ({ page }) => {
    const audit = createBrowserAudit(page);
    const crewJob = await getSeededCrewJob();

    await loginAsOperator(page, process.env.TEST_TENANT_B_ADMIN_EMAIL, process.env.TEST_TENANT_B_ADMIN_PASSWORD);

    await page.locator('.sidebar .tab[data-tab="team"]').click();
    await expect(page.locator("#teamMembersList")).toContainText(/Monday launch checklist/i, { timeout: 30000 });

    await page.evaluate(async () => {
      await window.switchTab?.("jobs", { force: true });
    });
    await expect(page.locator('[data-panel="jobs"]:not(.hidden) h2').first()).toHaveText(/Work|Jobs/i);
    await expect(page.locator("#jobsList")).toContainText(/Crew packet daylighting follow-up/i, { timeout: 30000 });

    await page.locator('[data-job-id]').filter({ hasText: "Crew packet daylighting follow-up" }).first().click();
    await expect(page.locator("#jobDetailWrap")).toContainText(/Crew handoff/i, { timeout: 30000 });
    await expect(page.locator("#jobDetailWrap")).toContainText(/Crew packet daylighting follow-up/i);

    const popupPromise = page.waitForEvent("popup");
    await page.locator("#btnJobAssignAndOpenCrew").click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    await expect.poll(() => popup.url(), { timeout: 30000 }).toContain(`/crew/?job=${crewJob.id}&source=operator`);
    await popup.close();

    await audit.expectClean("monday dry run operator");
  });

  test("crew member can land on the office handoff job and open the packet", async ({ page }) => {
    const audit = createBrowserAudit(page, {
      allowConsole: [/bad HTTP response code \(404\) was received when fetching the script/i],
    });
    const crewJob = await getSeededCrewJob();

    await loginAsCrew(page, "pltest.tenant.b.crew@example.com", "ChangeMe123!");
    await page.goto(`/crew/?job=${encodeURIComponent(crewJob.id)}&source=operator`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const infoCard = document.getElementById("jobInfoCard");
      return !!infoCard
        && getComputedStyle(infoCard).display !== "none"
        && !/loading/i.test(infoCard.textContent || "");
    }, null, { timeout: 45000 });

    await expect(page.locator("#jobInfoCard")).toContainText(/44 Service Drive, Detroit, MI|Dedicated crew-user fixture/i);
    await expect(page.locator("#toast, .toast")).toContainText(/office sent you|review the details before you roll/i);

    await audit.expectClean("monday dry run crew");
  });
});
