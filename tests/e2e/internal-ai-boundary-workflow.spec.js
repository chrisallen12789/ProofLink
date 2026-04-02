"use strict";

const { test, expect } = require("@playwright/test");

async function openStubbedOperatorWorkspace(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("pl_tour_v1", "1");
    window.localStorage.setItem("prooflink_tour_completed_v2", "1");
    window.localStorage.setItem("pl_onboarding_dismissed", "true");
  });
  await page.goto("/operator/");
  await page.waitForFunction(() => {
    return typeof window.renderDashboard === "function"
      && typeof window.switchTab === "function"
      && typeof window.renderJobDetail === "function"
      && typeof window.renderOrders === "function";
  });

  await page.evaluate(async () => {
    const blueprint = {
      business: { key: "cleaning", label: "Cleaning" },
      workflowRubric: {
        intake: "Capture what matters first.",
        scheduling: "Schedule with confidence.",
        field: "Field updates stay quick.",
        payment: "Collect on time.",
        repeatWork: "Turn wins into repeat work.",
      },
    };

    currentWorkspaceBlueprint = () => blueprint;
    DASHBOARD_LAUNCH_CHECKLIST = { steps: [], percent: 0, launch_ready: false };
    DASHBOARD_PAYMENT_STATE = null;
    LEADS_CACHE = [];
    BIDS_CACHE = [];
    PAYMENTS_CACHE = [];
    PRODUCTS_CACHE = [];
    BOOKINGS_CACHE = [];
    EXPENSES_CACHE = [];
    SERVICE_PLANS_CACHE = [];
    CUSTOMERS_CACHE = [
      {
        id: "customer_1",
        name: "Harbor Suites",
        email: "ops@example.com",
        phone: "555-111-2222",
        recurring_notes: "Weekly lobby touch-up",
        address: "100 Main St",
      },
    ];
    CRM_ORDERS_CACHE = [
      {
        id: "order_1",
        customer_id: "customer_1",
        customer_name: "Harbor Suites",
        status: "completed",
        total_cents: 18000,
        amount_paid_cents: 4000,
        amount_due_cents: 14000,
        service_address: "100 Main St",
        payment_due_date: "",
        order_external_id: "QB-221",
        notes: "Keep the QuickBooks invoice visible on the report.",
      },
    ];
    JOBS_CACHE = [
      {
        id: "job_1",
        customer_id: "customer_1",
        order_id: "order_1",
        title: "Lobby cleanup",
        status: "completed",
        service_address: "100 Main St",
        summary: "Weekly lobby touch-up",
        notes: "Need final field proof.",
      },
    ];

    requestOperatorFunction = async (functionName, options = {}) => {
      const key = options?.body?.agent_key;
      if (functionName !== "ai-agent-report") return {};

      if (key === "billing_blocker_detector") {
        return {
          report: {
            findings: [
              {
                title: "Missing signoff",
                detail: "A customer signoff is still missing from the completed work.",
                severity: "warning",
                record_refs: [
                  { record_type: "job", record_id: "job_1" },
                  { record_type: "customer", record_id: "customer_1" },
                  { record_type: "order", record_id: "order_1" },
                ],
              },
            ],
          },
          context_summary: { queued_jobs: 1 },
        };
      }

      if (key === "dispatch_scheduling_assistant") {
        return {
          report: {
            blockers: [{ code: "assignment_gap" }],
            findings: [
              {
                title: "Crew still needs assignment",
                detail: "Tomorrow's return visit still needs a crew assignment.",
                severity: "critical",
                record_refs: [{ record_type: "job", record_id: "job_1" }],
              },
            ],
          },
          context_summary: { open_jobs: 1 },
        };
      }

      if (key === "collections_followup_assistant") {
        return {
          report: {
            findings: [
              {
                title: "Due date needs to be set",
                detail: "The balance is open but the due date is still blank.",
                severity: "warning",
                record_refs: [
                  { record_type: "order", record_id: "order_1" },
                  { record_type: "customer", record_id: "customer_1" },
                ],
              },
            ],
          },
          context_summary: { overdue_count: 0, missing_due_dates: 1 },
        };
      }

      if (key === "job_record_auditor") {
        return {
          report: {
            summary: "Billing should wait until proof and signoff are complete.",
            findings: [
              {
                title: "Proof is incomplete",
                detail: "A completed photo set is still missing.",
                severity: "warning",
              },
            ],
            blockers: [],
            evidence: [],
            assumptions: [],
            confidence: { score: 0.82, rationale: "Grounded in the linked job and order data." },
            recommended_actions: [],
          },
        };
      }

      if (key === "field_closeout_coach") {
        return {
          report: {
            summary: "Closeout should stay with the field team until signoff lands.",
            findings: [
              {
                title: "Customer signoff is still missing",
                detail: "The office should not take over until the signoff is attached.",
                severity: "warning",
              },
            ],
            blockers: [],
            evidence: [],
            assumptions: [],
            confidence: { score: 0.8, rationale: "Grounded in the closeout package." },
            recommended_actions: [],
          },
        };
      }

      if (key === "site_packet_builder") {
        return {
          report: {
            summary: "The crew packet should lead with access notes and the latest proof.",
            findings: [
              {
                title: "Access note should be surfaced",
                detail: "Put the building entry detail at the top of the packet.",
                severity: "info",
              },
            ],
            blockers: [],
            evidence: [],
            assumptions: [],
            confidence: { score: 0.78, rationale: "Grounded in the linked customer and job." },
            recommended_actions: [],
          },
        };
      }

      if (key === "accounting_continuity_auditor") {
        return {
          report: {
            summary: "QuickBooks continuity is healthy once QB-221 is kept on the service trail.",
            findings: [
              {
                title: "External invoice reference is present",
                detail: "Keep QB-221 visible on the report and payment follow-through.",
                severity: "info",
              },
            ],
            blockers: [],
            evidence: [],
            assumptions: [],
            confidence: { score: 0.88, rationale: "Grounded in the order and continuity references." },
            recommended_actions: [],
          },
        };
      }

      return {};
    };
    window.requestOperatorFunction = requestOperatorFunction;

    document.getElementById("viewLogin")?.classList.add("hidden");
    document.getElementById("viewApp")?.classList.remove("hidden");
    window.PROOFLINK_BOOT_READY = true;

    renderDashboard();
    await switchTab("dashboard", { force: true, updateHash: false });
  });
}

test.describe("internal AI boundary workflow smoke", () => {
  test("operator workflow reviews stay visible without exposing the internal workforce layer", async ({ page }) => {
    await openStubbedOperatorWorkspace(page);

    const aiOpsCard = page.locator(".dashboard-focus-card");
    await expect(aiOpsCard.getByText("Ops priority queue")).toBeVisible();
    await expect(page.getByText("AI workforce architect")).toHaveCount(0);
    await aiOpsCard.getByRole("button", { name: "Run ops review" }).click();
    await expect(page.locator("#dashboardAiOpsMsg")).toContainText("Ops review refreshed.");
    const queueItem = aiOpsCard.locator(".memory-checklist__item", { hasText: "Missing signoff" }).first();
    await expect(queueItem).toBeVisible();
    await expect(queueItem.getByRole("button", { name: "Record payment" })).toBeVisible();
    await expect(queueItem.getByRole("button", { name: "Open order" })).toBeVisible();
    await expect(queueItem.getByRole("button", { name: "Open customer" })).toBeVisible();

    await page.evaluate(async () => {
      await switchTab("jobs", { force: true, updateHash: false });
      await window.renderJobDetail("job_1");
    });
    await expect(page.getByText("Billing readiness review")).toBeVisible();
    await expect(page.locator("#btnJobRunCloseoutCoach")).toBeVisible();
    await expect(page.locator("#btnJobRunSitePacket")).toBeVisible();

    await page.locator("#btnJobRunCloseoutCoach").click();
    await expect(page.locator("#jobCloseoutCoachMsg")).toContainText("Closeout review ready.");
    await expect(page.locator("#jobCloseoutCoachReport")).toContainText("Customer signoff is still missing");

    await page.locator("#btnJobRunSitePacket").click();
    await expect(page.locator("#jobSitePacketMsg")).toContainText("Site packet ready.");
    await expect(page.locator("#jobSitePacketReport")).toContainText("Access note should be surfaced");

    await page.evaluate(async () => {
      await switchTab("orders", { force: true, updateHash: false });
      renderOrders();
    });
    await expect(page.getByText("Accounting continuity check")).toBeVisible();
    await page.locator("#btnOrderRunAccountingAudit").click();
    await expect(page.locator("#orderAccountingAuditMsg")).toContainText("Continuity audit ready.");
    await expect(page.locator("#orderAccountingAuditReport")).toContainText("QB-221");
    await expect(page.getByText("Accounting Continuity Auditor")).toHaveCount(0);
  });

  test("admin portal keeps the internal workforce controls on the admin side only", async ({ page }) => {
    await page.goto("/admin/");
    await page.waitForFunction(() => typeof window.showSection === "function" && typeof window.setAuth === "function");

    await page.evaluate(() => {
      token = "stub-admin-token";
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (url, options = {}) => {
        const href = String(url);
        if (href.includes("/.netlify/functions/get-tenants")) {
          return new Response(JSON.stringify({
            tenants: [
              { id: "tenant_1", name: "Harbor Suites", slug: "harbor-suites" },
              { id: "tenant_2", name: "City Works", slug: "city-works" },
            ],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (href.includes("/.netlify/functions/ai-agent-report") && (!options.method || options.method === "GET")) {
          return new Response(JSON.stringify({
            agents: [
              { key: "job_record_auditor", label: "Job Record Auditor", purpose: "Reviews job records.", inputs: [], allowed_tools: ["get_job_record_audit_context"], confidence_signal: "Grounded in job data." },
              { key: "agent_workforce_architect", label: "AI Workforce Architect", purpose: "Finds new internal lanes.", inputs: [], allowed_tools: ["get_agent_workforce_context"], confidence_signal: "Grounded in tenant workload." },
            ],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (href.includes("/.netlify/functions/ai-agent-report") && options.method === "POST") {
          return new Response(JSON.stringify({
            report: {
              summary: "ProofLink should keep training the field and accounting lanes before adding another specialist.",
              findings: [
                { title: "Train the Field Closeout Coach", detail: "Billing cleanup still starts in field closeout.", severity: "warning" },
              ],
              blockers: [
                { title: "Adoption is still shallow", detail: "More live runs are needed before another lane is added." },
              ],
              recommended_actions: [
                { title: "Run the closeout lane from Jobs", detail: "Keep collecting real field blocker outcomes.", priority: "high" },
              ],
              confidence: { score: 0.86 },
            },
            context_summary: {
              new_agent_candidates: 0,
              training_targets: 2,
            },
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return originalFetch(url, options);
      };
      setAuth(false);
      showSection("ai-control");
    });

    const aiControlSection = page.locator("#section-ai-control");
    await expect(aiControlSection.locator(".page-title")).toHaveText("Internal AI Control");
    await expect(aiControlSection.locator(".page-sub")).toContainText("Tenant operators should only see workflow reviews");
    await expect(page.locator("#ai-roster-wrap")).toContainText("AI Workforce Architect");
    await aiControlSection.getByRole("button", { name: "Run workforce review" }).click();
    await expect(page.locator("#ai-control-msg")).toContainText("Internal workforce review ready.");
    await expect(page.locator("#ai-workforce-report-wrap")).toContainText("Train the Field Closeout Coach");
    await expect(page.locator("#ai-workforce-report-wrap")).toContainText("Adoption is still shallow");
    await expect(page.locator("#ai-workforce-report-wrap")).toContainText("Run the closeout lane from Jobs");
  });
});
