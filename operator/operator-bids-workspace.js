// Proposal workspace extracted from operator.js
// so bid drafting, proposal previews, and conversion stay in one domain module.
const BID_ESTIMATE_REVIEW_CACHE = window.PROOFLINK_BID_ESTIMATE_REVIEW_CACHE || (window.PROOFLINK_BID_ESTIMATE_REVIEW_CACHE = {});
const BID_PROPOSAL_READINESS_CACHE = window.PROOFLINK_BID_PROPOSAL_READINESS_CACHE || (window.PROOFLINK_BID_PROPOSAL_READINESS_CACHE = {});
const BID_QUOTE_RESCUE_STATE = window.PROOFLINK_BID_QUOTE_RESCUE_STATE || (window.PROOFLINK_BID_QUOTE_RESCUE_STATE = {
  loading: false,
  error: "",
  message: "",
  report: null,
  context_summary: null,
  generated_at: "",
});
const BID_UNSUPPORTED_COLUMNS = window.PROOFLINK_BID_UNSUPPORTED_COLUMNS || (window.PROOFLINK_BID_UNSUPPORTED_COLUMNS = new Set());

function bidAiStatusTone(status) {
  if (status === "ready") return "pill-good";
  if (status === "blocked") return "pill-bad";
  return "pill-warn";
}
function bidAiPriorityTone(priority) {
  if (priority === "high") return "pill-bad";
  if (priority === "low") return "";
  return "pill-warn";
}
function bidAiFormatStatus(value) {
  const normalized = String(value || "review_needed").replace(/_/g, " ").trim();
  if (typeof titleCaseWords === "function") return titleCaseWords(normalized);
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Review needed";
}
function bidAiFormatDate(value) {
  if (!value) return "";
  if (typeof formatDateTime === "function") return formatDateTime(value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}
function bidAiConfidenceLabel(report = {}) {
  if (report?.confidence?.label) return `Confidence ${report.confidence.label}`;
  const score = Number(report?.confidence?.score || 0);
  if (!Number.isFinite(score) || score <= 0) return "";
  return `Confidence ${Math.round(score * 100)}%`;
}
function bidAiRecordRef(item = {}, recordType = "") {
  return (Array.isArray(item.record_refs) ? item.record_refs : []).find((ref) => {
    return ref && ref.record_type === recordType && ref.record_id;
  }) || null;
}
function bidAiPrimaryRecordRef(item = {}) {
  const refs = Array.isArray(item.record_refs) ? item.record_refs : [];
  const preferredTypes = ["bid", "customer", "order", "job", "lead", "quote"];
  for (const recordType of preferredTypes) {
    const match = refs.find((ref) => ref && ref.record_type === recordType && ref.record_id);
    if (match) return match;
  }
  return refs.find((ref) => ref && ref.record_id) || null;
}
function openBidAiRecordRef(ref) {
  const recordType = String(ref?.record_type || "").trim().toLowerCase();
  const recordId = String(ref?.record_id || "").trim();
  if (!recordType || !recordId) return false;
  if (recordType === "bid") {
    ACTIVE_BID_ID = recordId;
    renderBids(bidSearch?.value || "", { preserveForm: true });
    return true;
  }
  if (recordType === "customer") {
    ACTIVE_CUSTOMER_ID = recordId;
    if (typeof switchTab === "function") switchTab("customers");
    const customerApi = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
    const customer = typeof findBidCustomer === "function" ? findBidCustomer(recordId) : null;
    if (typeof customerApi.renderCustomerDetailWorkspace === "function") {
      Promise.resolve(customerApi.renderCustomerDetailWorkspace(recordId, customer)).catch(console.error);
    }
    return true;
  }
  if (recordType === "order") {
    ACTIVE_ORDER_ID = recordId;
    if (typeof renderOrders === "function") renderOrders();
    if (typeof switchTab === "function") switchTab("orders");
    return true;
  }
  if (recordType === "job") {
    ACTIVE_JOB_ID = recordId;
    if (typeof renderJobs === "function") renderJobs();
    if (typeof switchTab === "function") switchTab("jobs");
    return true;
  }
  if (recordType === "lead") {
    ACTIVE_LEAD_ID = recordId;
    if (typeof renderLeads === "function") renderLeads();
    if (typeof switchTab === "function") switchTab("leads");
    return true;
  }
  if (recordType === "quote") {
    const customerRef = ref?.customer_id || "";
    if (customerRef) {
      ACTIVE_CUSTOMER_ID = customerRef;
      if (typeof switchTab === "function") switchTab("customers");
      return true;
    }
  }
  if (recordType === "workspace") {
    if (recordId === "proposal-settings" && typeof switchTab === "function") {
      switchTab("proposal-settings");
      return true;
    }
  }
  return false;
}
function renderBidProposalReadinessReport(state = null) {
  const report = state?.report || null;
  if (!report) {
    return `<div class="detail-copy">Run proposal readiness review to inspect branding defaults, signer setup, delivery fields, and send/convert blockers before the proposal goes out.</div>`;
  }
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  const summary = state?.context_summary || {};
  const generatedAt = report.generated_at || state?.generated_at || "";
  return `
    <div class="detail-copy">${escapeHtml(report.summary || "")}</div>
    <div class="workspace-chip-row u-mt-10">
      <span class="pill ${bidAiStatusTone(report.summary_status || "review_needed")}">${escapeHtml(bidAiFormatStatus(report.summary_status || "review_needed"))}</span>
      <span class="pill">${escapeHtml(`${summary.ready_checks || 0} ready`)}</span>
      ${summary.missing_required_checks ? `<span class="pill pill-bad">${escapeHtml(`${summary.missing_required_checks} required missing`)}</span>` : `<span class="pill pill-good">Required checks ready</span>`}
      ${summary.missing_optional_checks ? `<span class="pill pill-warn">${escapeHtml(`${summary.missing_optional_checks} optional missing`)}</span>` : ""}
    </div>
    ${blockers.length ? `
      <div class="memory-checklist u-mt-10">
        ${blockers.slice(0, 2).map((item) => `
          <div class="memory-checklist__item memory-checklist__item--warn">
            <div class="memory-checklist__title">${escapeHtml(item.title || "Proposal blocker")}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${findings.length ? `
      <div class="memory-checklist u-mt-10">
        ${findings.slice(0, 4).map((item) => `
          <div class="memory-checklist__item ${item.severity === "warning" ? "memory-checklist__item--warn" : "memory-checklist__item--ready"}">
            <div class="memory-checklist__title">${escapeHtml(item.title || "Proposal finding")}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${generatedAt ? `<div class="detail-copy u-mt-10 muted">Generated ${escapeHtml(bidAiFormatDate(generatedAt))}</div>` : ""}
  `;
}
function renderBidProposalReadinessCard(draft) {
  if (!bidProposalReadinessWrap) return;
  if (!draft) {
    bidProposalReadinessWrap.innerHTML = `<div class="detail-copy">Select a walkthrough bid to run proposal readiness review from this workspace.</div>`;
    return;
  }
  const cacheKey = String(draft.id || bidRecordId(draft) || "").trim();
  const state = BID_PROPOSAL_READINESS_CACHE[cacheKey] || null;
  bidProposalReadinessWrap.innerHTML = `
    <div class="detail-copy">Check proposal defaults, signer setup, delivery note, validity timing, and deposit readiness before send or convert.</div>
    <div class="action-row action-row--wrap u-mt-10">
      <button type="button" class="btn btn-ghost btn-sm" id="btnRunBidProposalReadinessReview">${state?.report ? "Run again" : "Run proposal readiness review"}</button>
      <button type="button" class="btn btn-ghost btn-sm" id="btnOpenProposalSettingsFromReview">Open proposal settings</button>
    </div>
    <div id="bidProposalReadinessMsg" class="msg ${state?.error ? "error" : state?.loading ? "" : state?.message ? "ok" : ""} u-mt-10">${escapeHtml(state?.loading ? "Reviewing proposal readiness..." : state?.error || state?.message || "")}</div>
    <div id="bidProposalReadinessReport" class="u-mt-10">${renderBidProposalReadinessReport(state)}</div>
  `;
  bidProposalReadinessWrap.querySelector("#btnRunBidProposalReadinessReview")?.addEventListener("click", () => {
    runBidProposalReadinessReview(draft).catch(console.error);
  });
  bidProposalReadinessWrap.querySelector("#btnOpenProposalSettingsFromReview")?.addEventListener("click", () => {
    if (typeof switchTab === "function") Promise.resolve(switchTab("proposal-settings")).catch(console.error);
  });
}
async function runBidProposalReadinessReview(draft = currentBid(), options = {}) {
  const activeDraft = draft || currentBid();
  if (!activeDraft) return null;
  const cacheKey = String(activeDraft.id || bidRecordId(activeDraft) || "").trim() || "__draft__";
  BID_PROPOSAL_READINESS_CACHE[cacheKey] = {
    ...(BID_PROPOSAL_READINESS_CACHE[cacheKey] || {}),
    loading: true,
    error: "",
    message: "",
  };
  if (options.rerender !== false) renderBidWorkspace(activeDraft, { preserveForm: true });
  if (typeof requestOperatorFunction !== "function") {
    BID_PROPOSAL_READINESS_CACHE[cacheKey] = {
      ...(BID_PROPOSAL_READINESS_CACHE[cacheKey] || {}),
      loading: false,
      error: "Proposal readiness tools are not ready yet.",
      message: "",
    };
    if (options.rerender !== false) renderBidWorkspace(activeDraft, { preserveForm: true });
    return BID_PROPOSAL_READINESS_CACHE[cacheKey];
  }
  try {
    let readyDraft = activeDraft;
    let remoteBidId = bidRecordId(readyDraft);
    if (!remoteBidId) {
      const syncedDraft = await flushBidDraftSync({ throwOnError: true });
      readyDraft = syncedDraft || currentBid() || readyDraft;
      remoteBidId = bidRecordId(readyDraft);
    }
    if (!remoteBidId) throw new Error("Save the proposal before running proposal readiness review.");
    const payload = await requestOperatorFunction("ai-agent-report", {
      method: "POST",
      body: {
        agent_key: "proposal_readiness_auditor",
        bid_id: remoteBidId,
      },
    });
    const nextKey = String(readyDraft.id || remoteBidId || cacheKey).trim() || cacheKey;
    BID_PROPOSAL_READINESS_CACHE[nextKey] = {
      loading: false,
      error: "",
      message: "Proposal readiness review refreshed.",
      report: payload?.report || null,
      context_summary: payload?.context_summary || null,
      generated_at: payload?.generated_at || payload?.report?.generated_at || "",
    };
    if (nextKey !== cacheKey) delete BID_PROPOSAL_READINESS_CACHE[cacheKey];
    if (options.rerender !== false) renderBidWorkspace(currentBid() || readyDraft, { preserveForm: true });
    return BID_PROPOSAL_READINESS_CACHE[nextKey];
  } catch (error) {
    BID_PROPOSAL_READINESS_CACHE[cacheKey] = {
      ...(BID_PROPOSAL_READINESS_CACHE[cacheKey] || {}),
      loading: false,
      error: error?.message || String(error),
      message: "",
    };
    if (options.rerender !== false) renderBidWorkspace(currentBid() || activeDraft, { preserveForm: true });
    return BID_PROPOSAL_READINESS_CACHE[cacheKey];
  }
}
function renderBidEstimateReviewReport(state = null) {
  const report = state?.report || null;
  if (!report) {
    return `<div class="detail-copy">Run the estimate review to separate grounded scope and pricing facts from the inputs that are still missing before you send or revise this proposal.</div>`;
  }
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  const actions = Array.isArray(report.recommended_actions) ? report.recommended_actions : [];
  const missingData = Array.isArray(report.missing_data) ? report.missing_data : [];
  const dataUsed = Array.isArray(report.data_used) ? report.data_used.filter((item) => item && item.count > 0) : [];
  const confidenceLabel = bidAiConfidenceLabel(report);
  const generatedAt = report.generated_at || state?.generated_at || "";

  return `
    <div class="detail-copy">${escapeHtml(report.summary || "")}</div>
    <div class="workspace-chip-row u-mt-10">
      <span class="pill ${bidAiStatusTone(report.summary_status || "review_needed")}">${escapeHtml(bidAiFormatStatus(report.summary_status || "review_needed"))}</span>
      ${blockers.length ? `<span class="pill pill-bad">${escapeHtml(`${blockers.length} blocker${blockers.length === 1 ? "" : "s"}`)}</span>` : `<span class="pill pill-good">No blockers found</span>`}
      ${confidenceLabel ? `<span class="pill">${escapeHtml(confidenceLabel)}</span>` : ""}
    </div>
    ${blockers.length ? `
      <div class="memory-checklist u-mt-10">
        ${blockers.slice(0, 2).map((item) => `
          <div class="memory-checklist__item memory-checklist__item--warn">
            <div class="memory-checklist__title">${escapeHtml(item.title || "Estimate blocker")}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${findings.length ? `
      <div class="detail-copy u-mt-10"><strong>Estimate findings</strong></div>
      <div class="memory-checklist u-mt-10">
        ${findings.slice(0, 4).map((item) => {
          const primaryRef = bidAiPrimaryRecordRef(item);
          return `
            <div class="memory-checklist__item ${item.severity === "warning" || item.severity === "critical" ? "memory-checklist__item--warn" : "memory-checklist__item--ready"}">
              <div class="memory-checklist__title">${escapeHtml(item.title || "Estimate finding")}</div>
              <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
              ${primaryRef ? `
                <div class="action-row action-row--wrap u-mt-10">
                  <button type="button" class="btn btn-ghost btn-sm" data-bid-estimate-open-record="${escapeAttr(primaryRef.record_type)}" data-bid-estimate-record-id="${escapeAttr(primaryRef.record_id)}">Open ${escapeHtml(primaryRef.label || primaryRef.record_type)}</button>
                </div>
              ` : ""}
            </div>
          `;
        }).join("")}
      </div>
    ` : ""}
    ${actions.length ? `
      <div class="detail-copy u-mt-10"><strong>Recommended actions</strong></div>
      <div class="workspace-chip-row">
        ${actions.slice(0, 3).map((action) => `<span class="pill ${bidAiPriorityTone(action.priority || "medium")}">${escapeHtml(bidAiFormatStatus(`${action.priority || "medium"} priority`))}</span>`).join("")}
      </div>
      <div class="memory-checklist u-mt-10">
        ${actions.slice(0, 3).map((action) => `
          <div class="memory-checklist__item ${action.priority === "high" ? "memory-checklist__item--warn" : "memory-checklist__item--ready"}">
            <div class="memory-checklist__title">${escapeHtml(action.title || "Recommended action")}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(action.detail || "")}</div>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${missingData.length ? `
      <div class="detail-copy u-mt-10"><strong>Missing data</strong></div>
      <div class="detail-copy">${escapeHtml(missingData.slice(0, 3).map((item) => item.label || item.detail || "").join(" | "))}</div>
    ` : ""}
    ${dataUsed.length ? `
      <div class="detail-copy u-mt-10"><strong>Data used</strong></div>
      <div class="workspace-chip-row">
        ${dataUsed.slice(0, 4).map((item) => `<span class="pill">${escapeHtml(`${item.label}: ${item.count}`)}</span>`).join("")}
      </div>
    ` : ""}
    ${generatedAt ? `<div class="detail-copy u-mt-10 muted">Generated ${escapeHtml(bidAiFormatDate(generatedAt))}</div>` : ""}
  `;
}
function renderBidEstimateReviewCard(draft) {
  if (!bidEstimateReviewWrap) return;
  if (!draft) {
    bidEstimateReviewWrap.innerHTML = `<div class="detail-copy">Select a walkthrough bid to run estimate review from this workspace.</div>`;
    return;
  }
  const cacheKey = String(draft.id || bidRecordId(draft) || "").trim();
  const state = BID_ESTIMATE_REVIEW_CACHE[cacheKey] || null;
  const primaryFinding = bidAiPrimaryRecordRef(state?.report?.findings?.[0] || {});
  bidEstimateReviewWrap.innerHTML = `
    <div class="detail-copy">Review grounded scope, measurements, and price support before the proposal goes out or comes back for revision.</div>
    <div class="action-row action-row--wrap u-mt-10">
      <button type="button" class="btn btn-ghost btn-sm" id="btnRunBidEstimateReview">${state?.report ? "Run again" : "Run estimate review"}</button>
      ${primaryFinding ? `<button type="button" class="btn btn-ghost btn-sm" id="btnOpenBidEstimatePrimary">Open first record</button>` : ""}
    </div>
    <div id="bidEstimateReviewMsg" class="msg ${state?.error ? "error" : state?.loading ? "" : state?.message ? "ok" : ""} u-mt-10">${escapeHtml(state?.loading ? "Running estimate review..." : state?.error || state?.message || "")}</div>
    <div id="bidEstimateReviewReport" class="u-mt-10">${renderBidEstimateReviewReport(state)}</div>
  `;
  bidEstimateReviewWrap.querySelector("#btnRunBidEstimateReview")?.addEventListener("click", () => {
    runBidEstimateReview(draft).catch(console.error);
  });
  bidEstimateReviewWrap.querySelector("#btnOpenBidEstimatePrimary")?.addEventListener("click", () => {
    openBidAiRecordRef(primaryFinding);
  });
  bidEstimateReviewWrap.querySelectorAll("[data-bid-estimate-open-record][data-bid-estimate-record-id]").forEach((button) => {
    button.addEventListener("click", () => {
      openBidAiRecordRef({
        record_type: button.getAttribute("data-bid-estimate-open-record") || "",
        record_id: button.getAttribute("data-bid-estimate-record-id") || "",
        label: button.textContent || "",
      });
    });
  });
}
async function runBidEstimateReview(draft = currentBid(), options = {}) {
  const activeDraft = draft || currentBid();
  if (!activeDraft) return null;
  const cacheKey = String(activeDraft.id || bidRecordId(activeDraft) || "").trim() || "__draft__";
  BID_ESTIMATE_REVIEW_CACHE[cacheKey] = {
    ...(BID_ESTIMATE_REVIEW_CACHE[cacheKey] || {}),
    loading: true,
    error: "",
    message: "",
  };
  if (options.rerender !== false) renderBidWorkspace(activeDraft, { preserveForm: true });
  if (typeof requestOperatorFunction !== "function") {
    BID_ESTIMATE_REVIEW_CACHE[cacheKey] = {
      ...(BID_ESTIMATE_REVIEW_CACHE[cacheKey] || {}),
      loading: false,
      error: "Estimate review tools are not ready yet.",
      message: "",
    };
    if (options.rerender !== false) renderBidWorkspace(activeDraft, { preserveForm: true });
    return BID_ESTIMATE_REVIEW_CACHE[cacheKey];
  }
  try {
    let readyDraft = activeDraft;
    let remoteBidId = bidRecordId(readyDraft);
    if (!remoteBidId) {
      const syncedDraft = await flushBidDraftSync({ throwOnError: true });
      readyDraft = syncedDraft || currentBid() || readyDraft;
      remoteBidId = bidRecordId(readyDraft);
    }
    if (!remoteBidId) throw new Error("Save the proposal before running estimate review.");
    const payload = await requestOperatorFunction("ai-agent-report", {
      method: "POST",
      body: {
        agent_key: "estimating_assistant",
        bid_id: remoteBidId,
      },
    });
    const nextKey = String(readyDraft.id || remoteBidId || cacheKey).trim() || cacheKey;
    BID_ESTIMATE_REVIEW_CACHE[nextKey] = {
      loading: false,
      error: "",
      message: "Estimate review refreshed.",
      report: payload?.report || null,
      context_summary: payload?.context_summary || null,
      generated_at: payload?.generated_at || payload?.report?.generated_at || "",
    };
    if (nextKey !== cacheKey) delete BID_ESTIMATE_REVIEW_CACHE[cacheKey];
    if (options.rerender !== false) renderBidWorkspace(currentBid() || readyDraft, { preserveForm: true });
    return BID_ESTIMATE_REVIEW_CACHE[nextKey];
  } catch (error) {
    BID_ESTIMATE_REVIEW_CACHE[cacheKey] = {
      ...(BID_ESTIMATE_REVIEW_CACHE[cacheKey] || {}),
      loading: false,
      error: error?.message || String(error),
      message: "",
    };
    if (options.rerender !== false) renderBidWorkspace(currentBid() || activeDraft, { preserveForm: true });
    return BID_ESTIMATE_REVIEW_CACHE[cacheKey];
  }
}
function renderBidQuoteRescueReport(state = BID_QUOTE_RESCUE_STATE) {
  const report = state?.report || null;
  if (!report) {
    return `<div class="detail-copy">Run the quote rescue review to separate follow-up-ready proposal records from estimate cleanup work, active decision-window items, and stale records that should be reworked first.</div>`;
  }
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  const actions = Array.isArray(report.recommended_actions) ? report.recommended_actions : [];
  const summary = state?.context_summary || {};
  const generatedAt = report.generated_at || state?.generated_at || "";
  return `
    <div class="detail-copy">${escapeHtml(report.summary || "")}</div>
    <div class="workspace-chip-row u-mt-10">
      <span class="pill ${bidAiStatusTone(report.summary_status || "review_needed")}">${escapeHtml(bidAiFormatStatus(report.summary_status || "review_needed"))}</span>
      ${summary.total_records ? `<span class="pill">${escapeHtml(`${summary.total_records} candidate${summary.total_records === 1 ? "" : "s"}`)}</span>` : ""}
      ${summary.ready_to_follow_up ? `<span class="pill pill-good">${escapeHtml(`${summary.ready_to_follow_up} ready`)}</span>` : ""}
      ${summary.missing_estimate_facts ? `<span class="pill pill-warn">${escapeHtml(`${summary.missing_estimate_facts} missing facts`)}</span>` : ""}
      ${summary.stale_enough_to_rework ? `<span class="pill pill-bad">${escapeHtml(`${summary.stale_enough_to_rework} stale`)}</span>` : ""}
    </div>
    ${blockers.length ? `
      <div class="memory-checklist u-mt-10">
        ${blockers.slice(0, 2).map((item) => `
          <div class="memory-checklist__item memory-checklist__item--warn">
            <div class="memory-checklist__title">${escapeHtml(item.title || "Proposal blocker")}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${findings.length ? `
      <div class="detail-copy u-mt-10"><strong>Proposal queue</strong></div>
      <div class="memory-checklist u-mt-10">
        ${findings.slice(0, 6).map((item) => {
          const primaryRef = bidAiPrimaryRecordRef(item);
          const customerRef = bidAiRecordRef(item, "customer");
          return `
            <div class="memory-checklist__item ${item.category === "stale_enough_to_rework" || item.category === "missing_estimate_facts" ? "memory-checklist__item--warn" : "memory-checklist__item--ready"}">
              <div class="memory-checklist__title">${escapeHtml(item.title || "Queue item")}</div>
              <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
              <div class="action-row action-row--wrap u-mt-10">
                ${primaryRef ? `<button type="button" class="btn btn-primary btn-sm" data-bid-quote-rescue-open-record="${escapeAttr(primaryRef.record_type)}" data-bid-quote-rescue-record-id="${escapeAttr(primaryRef.record_id)}">Open ${escapeHtml(primaryRef.label || primaryRef.record_type)}</button>` : ""}
                ${customerRef ? `<button type="button" class="btn btn-ghost btn-sm" data-bid-quote-rescue-open-record="${escapeAttr(customerRef.record_type)}" data-bid-quote-rescue-record-id="${escapeAttr(customerRef.record_id)}">Open ${escapeHtml(customerRef.label || "customer")}</button>` : ""}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    ` : ""}
    ${actions.length ? `
      <div class="detail-copy u-mt-10"><strong>Recommended queue moves</strong></div>
      <div class="memory-checklist u-mt-10">
        ${actions.slice(0, 3).map((action) => `
          <div class="memory-checklist__item ${action.priority === "high" ? "memory-checklist__item--warn" : "memory-checklist__item--ready"}">
            <div class="memory-checklist__title">${escapeHtml(action.title || "Recommended action")}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(action.detail || "")}</div>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${generatedAt ? `<div class="detail-copy u-mt-10 muted">Generated ${escapeHtml(bidAiFormatDate(generatedAt))}</div>` : ""}
  `;
}
function renderBidQuoteRescueCard() {
  if (!bidQuoteRescueWrap) return;
  const firstFinding = BID_QUOTE_RESCUE_STATE?.report?.findings?.[0] || null;
  const primaryRef = bidAiPrimaryRecordRef(firstFinding || {});
  bidQuoteRescueWrap.innerHTML = `
    <div class="detail-copy">Use one rescue queue to separate follow-up-ready proposal records, missing estimate facts, and stale records that should be tightened before another send.</div>
    <div class="action-row action-row--wrap u-mt-10">
      <button type="button" class="btn btn-ghost btn-sm" id="btnRunBidQuoteRescueReview">${BID_QUOTE_RESCUE_STATE?.report ? "Run again" : "Run quote rescue review"}</button>
      ${primaryRef ? `<button type="button" class="btn btn-ghost btn-sm" id="btnOpenBidQuoteRescuePrimary">Open first record</button>` : ""}
    </div>
    <div id="bidQuoteRescueMsg" class="msg ${BID_QUOTE_RESCUE_STATE?.error ? "error" : BID_QUOTE_RESCUE_STATE?.loading ? "" : BID_QUOTE_RESCUE_STATE?.message ? "ok" : ""} u-mt-10">${escapeHtml(BID_QUOTE_RESCUE_STATE?.loading ? "Reviewing proposal rescue queue..." : BID_QUOTE_RESCUE_STATE?.error || BID_QUOTE_RESCUE_STATE?.message || "")}</div>
    <div id="bidQuoteRescueReport" class="u-mt-10">${renderBidQuoteRescueReport(BID_QUOTE_RESCUE_STATE)}</div>
  `;
  bidQuoteRescueWrap.querySelector("#btnRunBidQuoteRescueReview")?.addEventListener("click", () => {
    runBidQuoteRescueReview().catch(console.error);
  });
  bidQuoteRescueWrap.querySelector("#btnOpenBidQuoteRescuePrimary")?.addEventListener("click", () => {
    openBidAiRecordRef(primaryRef);
  });
  bidQuoteRescueWrap.querySelectorAll("[data-bid-quote-rescue-open-record][data-bid-quote-rescue-record-id]").forEach((button) => {
    button.addEventListener("click", () => {
      openBidAiRecordRef({
        record_type: button.getAttribute("data-bid-quote-rescue-open-record") || "",
        record_id: button.getAttribute("data-bid-quote-rescue-record-id") || "",
        label: button.textContent || "",
      });
    });
  });
}
async function runBidQuoteRescueReview(options = {}) {
  BID_QUOTE_RESCUE_STATE.loading = true;
  BID_QUOTE_RESCUE_STATE.error = "";
  BID_QUOTE_RESCUE_STATE.message = "";
  if (options.rerender !== false) renderBidQuoteRescueCard();
  if (typeof requestOperatorFunction !== "function") {
    BID_QUOTE_RESCUE_STATE.loading = false;
    BID_QUOTE_RESCUE_STATE.error = "Quote rescue tools are not ready yet.";
    if (options.rerender !== false) renderBidQuoteRescueCard();
    return BID_QUOTE_RESCUE_STATE;
  }
  try {
    const payload = await requestOperatorFunction("ai-agent-report", {
      method: "POST",
      body: {
        agent_key: "quote_rescue_manager",
      },
    });
    BID_QUOTE_RESCUE_STATE.loading = false;
    BID_QUOTE_RESCUE_STATE.error = "";
    BID_QUOTE_RESCUE_STATE.message = "Proposal rescue review refreshed.";
    BID_QUOTE_RESCUE_STATE.report = payload?.report || null;
    BID_QUOTE_RESCUE_STATE.context_summary = payload?.context_summary || null;
    BID_QUOTE_RESCUE_STATE.generated_at = payload?.generated_at || payload?.report?.generated_at || "";
    if (options.rerender !== false) renderBidQuoteRescueCard();
    return BID_QUOTE_RESCUE_STATE;
  } catch (error) {
    BID_QUOTE_RESCUE_STATE.loading = false;
    BID_QUOTE_RESCUE_STATE.error = error?.message || String(error);
    BID_QUOTE_RESCUE_STATE.message = "";
    if (options.rerender !== false) renderBidQuoteRescueCard();
    return BID_QUOTE_RESCUE_STATE;
  }
}
function persistBidDrafts() {
  try {
    window.localStorage.setItem(bidStorageKey(), JSON.stringify(BIDS_CACHE || []));
    return true;
  } catch (err) {
    setInlineMessage(bidMsg, err.message || "Bid drafts could not be saved in this browser.", "error");
    return false;
  }
}
function setBidWorkspaceBootstrapping(pending, message = "") {
  BID_WORKSPACE_BOOTSTRAPPING = !!pending;
  if (bidForm) {
    bidForm.hidden = !!pending;
    bidForm.setAttribute("aria-busy", pending ? "true" : "false");
  }
  const host = bidForm?.parentElement;
  if (!host) return;
  let state = host.querySelector("#bidWorkspaceBootstrappingState");
  if (!state) {
    state = document.createElement("div");
    state.id = "bidWorkspaceBootstrappingState";
    state.className = "detail-copy";
    state.style.marginBottom = "14px";
    host.insertBefore(state, bidForm || null);
  }
  state.hidden = !pending;
  state.textContent = pending ? (message || "Opening proposal builder...") : "";
}
function proposalDocumentsApi() {
  return window.PROOFLINK_OPERATOR_PROPOSAL_DOCUMENTS || null;
}
function bidSchemaErrorText(error) {
  return [
    error?.message,
    error?.details,
    error?.hint,
    error?.error_description,
  ].filter(Boolean).join(" | ");
}
function extractMissingBidColumn(error) {
  const message = String(bidSchemaErrorText(error) || "");
  const patterns = [
    /could not find the ['"]?([^'"]+)['"]? column of ['"]?bids['"]? in the schema cache/i,
    /column ['"]?([^'".]+)['"]? of relation ['"]?bids['"]? does not exist/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}
function stripUnsupportedBidColumns(payload = {}) {
  if (!payload || typeof payload !== "object" || !BID_UNSUPPORTED_COLUMNS.size) return payload;
  const nextPayload = { ...payload };
  BID_UNSUPPORTED_COLUMNS.forEach((column) => {
    if (Object.prototype.hasOwnProperty.call(nextPayload, column)) delete nextPayload[column];
  });
  return nextPayload;
}
function mergeUnsupportedBidColumns(draft = {}, sourceDraft = null) {
  if (!sourceDraft || !BID_UNSUPPORTED_COLUMNS.size) return draft;
  const nextDraft = { ...draft };
  BID_UNSUPPORTED_COLUMNS.forEach((column) => {
    if (!Object.prototype.hasOwnProperty.call(sourceDraft, column)) return;
    const sourceValue = sourceDraft[column];
    if (sourceValue == null || sourceValue === "") return;
    if (nextDraft[column] == null || nextDraft[column] === "") {
      nextDraft[column] = sourceValue;
    }
  });
  return nextDraft;
}
function matchingLocalBidDraft(targetDraft, localRows = BIDS_CACHE || []) {
  const targetId = String(targetDraft?.id || "").trim();
  const targetRecordId = String(bidRecordId(targetDraft) || "").trim();
  return (localRows || []).find((row) => {
    const rowId = String(row?.id || "").trim();
    const rowRecordId = String(bidRecordId(row) || "").trim();
    return (targetId && rowId === targetId) || (targetRecordId && rowRecordId === targetRecordId);
  }) || null;
}
async function persistBidDraftRow(active, rowPayload) {
  let nextPayload = stripUnsupportedBidColumns(rowPayload);
  while (true) {
    const recordId = bidRecordId(active);
    const query = recordId
      ? sb.from("bids").update(nextPayload).eq("id", recordId).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
      : sb.from("bids").insert({ ...nextPayload, created_at: active.created_at || new Date().toISOString() });
    const { data, error } = await query.select("*").single();
    if (!error) return { data, payload: nextPayload };

    const missingColumn = extractMissingBidColumn(error);
    if (!missingColumn || !Object.prototype.hasOwnProperty.call(nextPayload, missingColumn)) throw error;

    BID_UNSUPPORTED_COLUMNS.add(missingColumn);
    const retryPayload = { ...nextPayload };
    delete retryPayload[missingColumn];
    nextPayload = retryPayload;
  }
}
function loadBidDrafts() {
  try {
    const raw = window.localStorage.getItem(bidStorageKey());
    const parsed = raw ? JSON.parse(raw) : [];
    BIDS_CACHE = Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    BIDS_CACHE = [];
  }
  ACTIVE_BID_ID = BIDS_CACHE[0]?.id || null;
}
async function loadPersistedBids() {
  const remoteRows = await fetchPersistedBids();
  const remoteDrafts = remoteRows.map(draftFromBidRow);
  const proposalApi = proposalDocumentsApi();
  const hydratedDrafts = proposalApi?.hydrateDrafts
    ? await proposalApi.hydrateDrafts(remoteDrafts).catch(() => remoteDrafts)
    : remoteDrafts;
  const compatibleDrafts = hydratedDrafts.map((draft) => mergeUnsupportedBidColumns(draft, matchingLocalBidDraft(draft)));
  BIDS_CACHE = mergeBidDraftCollections(BIDS_CACHE, compatibleDrafts);
  persistBidDrafts();
  ACTIVE_BID_ID = ACTIVE_BID_ID && BIDS_CACHE.some((row) => row.id === ACTIVE_BID_ID)
    ? ACTIVE_BID_ID
    : (BIDS_CACHE[0]?.id || null);
  return BIDS_CACHE;
}
async function flushBidDraftSync(options = {}) {
  if (BID_SYNC_PROMISE) {
    try {
      await BID_SYNC_PROMISE;
    } catch (err) {
      if (options.throwOnError) throw err;
      return null;
    }
  }

  const runSync = async () => {
    let lastSyncedDraft = null;
    while (true) {
      const active = currentBid();
      if (!active || !CURRENT_OPERATOR?.operator_id) return lastSyncedDraft;

      const activeUpdatedAt = String(active.updated_at || "");
      const rowPayload = bidRowFromDraft(active);
      const { data } = await persistBidDraftRow(active, rowPayload);

      const remoteDraft = draftFromBidRow(data);
      const latestDraft = BIDS_CACHE.find((row) => row.id === active.id) || active;
      const changedWhileSyncing = String(latestDraft.updated_at || "") !== activeUpdatedAt;
      const baseDraft = changedWhileSyncing ? latestDraft : active;
      const nextDraft = mergeUnsupportedBidColumns(changedWhileSyncing
        ? {
            ...baseDraft,
            record_id: data.id,
            metadata: {
              ...(remoteDraft.metadata || {}),
              ...(baseDraft.metadata || {}),
              local_draft_id: baseDraft.id,
            },
          }
        : {
            ...baseDraft,
            ...remoteDraft,
            id: baseDraft.id,
            record_id: data.id,
            metadata: {
              ...(remoteDraft.metadata || {}),
              ...(baseDraft.metadata || {}),
              local_draft_id: baseDraft.id,
            },
          }, baseDraft);

      const proposalApi = proposalDocumentsApi();
      const proposalSyncOptions = options.proposalSync && typeof options.proposalSync === "object"
        ? options.proposalSync
        : { createVersion: false };
      const syncedDocumentDraft = proposalApi?.syncFromBidDraft
        ? await proposalApi.syncFromBidDraft(nextDraft, proposalSyncOptions).catch(() => nextDraft)
        : nextDraft;

      BIDS_CACHE = BIDS_CACHE.map((row) => row.id === baseDraft.id ? syncedDocumentDraft : row);
      ACTIVE_BID_ID = syncedDocumentDraft.id;
      persistBidDrafts();
      lastSyncedDraft = syncedDocumentDraft;

      if (!changedWhileSyncing) return lastSyncedDraft;
    }
  };

  BID_SYNC_IN_FLIGHT = true;
  BID_SYNC_PROMISE = runSync();
  try {
    return await BID_SYNC_PROMISE;
  } catch (err) {
    console.error("[bids] sync failed", err);
    if (options.throwOnError) throw err;
  } finally {
    BID_SYNC_IN_FLIGHT = false;
    BID_SYNC_PROMISE = null;
  }
  return null;
}
function queueBidDraftSync(delayMs = 500) {
  if (BID_SYNC_TIMER) window.clearTimeout(BID_SYNC_TIMER);
  BID_SYNC_TIMER = window.setTimeout(() => {
    flushBidDraftSync().catch(console.error);
  }, delayMs);
}
function replaceBidDraft(nextDraft) {
  BIDS_CACHE = [...(BIDS_CACHE || []).filter((row) => row.id !== nextDraft.id), nextDraft]
    .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
  ACTIVE_BID_ID = nextDraft.id;
  persistBidDrafts();
  queueBidDraftSync();
  return nextDraft;
}
function sortedBids(filter = "") {
  const needle = String(filter || "").trim().toLowerCase();
  const rows = [...(BIDS_CACHE || [])].sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
  if (!needle) return rows;
  return rows.filter((row) => {
    const customer = findBidCustomer(row.customer_id);
    const haystack = [
      row.title,
      customer?.name,
      row.service_address,
      row.status,
      bidProfileConfig(row.profile).label,
      row.project_summary,
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}
function renderBidCustomerOptions(selected = "") {
  if (!bidCustomerId) return;
  const options = sortedCustomers(CUSTOMERS_CACHE);
  bidCustomerId.innerHTML = [
    `<option value="">Link customer later</option>`,
    ...options.map((customer) => `<option value="${escapeAttr(customer.id)}" ${customer.id === selected ? "selected" : ""}>${escapeHtml(customer.name || "Unnamed customer")}</option>`),
  ].join("");
}
function clearBidQuickCustomerForm() {
  if (bidQuickCustomerName) bidQuickCustomerName.value = "";
  if (bidQuickCustomerEmail) bidQuickCustomerEmail.value = "";
  if (bidQuickCustomerPhone) bidQuickCustomerPhone.value = "";
  if (bidQuickCustomerPreferredContact) bidQuickCustomerPreferredContact.value = "email";
  if (bidQuickCustomerNote) bidQuickCustomerNote.value = "";
  setInlineMessage(bidQuickCustomerMsg, "");
}
function setBidQuickCustomerOpen(nextOpen, opts = {}) {
  BID_QUICK_CUSTOMER_OPEN = !!nextOpen;
  if (bidQuickCustomerCard) bidQuickCustomerCard.classList.toggle("is-open", BID_QUICK_CUSTOMER_OPEN);
  if (bidQuickCustomerForm) bidQuickCustomerForm.classList.toggle("hidden", !BID_QUICK_CUSTOMER_OPEN);
  if (!BID_QUICK_CUSTOMER_OPEN && opts.keepValues !== true) clearBidQuickCustomerForm();
}
function renderBidQuickCustomerCard(draft) {
  if (!bidQuickCustomerCard) return;
  const linkedCustomer = findBidCustomer(draft?.customer_id || "");
  const hasCustomers = CUSTOMERS_CACHE.length > 0;
  const forceOpen = !linkedCustomer && !hasCustomers;
  const nextOpen = forceOpen || BID_QUICK_CUSTOMER_OPEN;

  if (bidQuickCustomerHeading) {
    bidQuickCustomerHeading.textContent = linkedCustomer
      ? "Customer record linked"
      : (!hasCustomers ? "No customers in CRM yet" : "Need a new customer?");
  }
  if (bidQuickCustomerSummary) {
    bidQuickCustomerSummary.textContent = linkedCustomer
      ? `${linkedCustomer.name || "This customer"} is attached to the bid. Create another customer here only if this walkthrough belongs to someone else.`
      : (!hasCustomers
          ? "Capture the first customer here without leaving the walkthrough. A name plus email or phone is enough to keep moving."
          : "Link an existing customer above, or capture a brand-new one here without leaving the walkthrough.");
  }
  if (btnToggleBidQuickCustomer) {
    btnToggleBidQuickCustomer.textContent = forceOpen
      ? "Customer details below"
      : (nextOpen ? "Hide quick customer" : "Create customer here");
    btnToggleBidQuickCustomer.disabled = forceOpen;
  }
  setBidQuickCustomerOpen(nextOpen, { keepValues: true });
}
function attachCustomerToCurrentBid(customer) {
  if (!customer?.id) return null;
  const active = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!active) return null;
  const currentTitle = String(active.title || "").trim();
  const previousDefaultTitle = defaultBidTitleFromDraft(active);
  const nextDraft = {
    ...active,
    customer_id: customer.id,
    updated_at: new Date().toISOString(),
  };
  if (!currentTitle || currentTitle === previousDefaultTitle) {
    nextDraft.title = defaultBidTitleFromDraft(nextDraft);
  }
  replaceBidDraft(nextDraft);
  return nextDraft;
}
function clearBidLineItemForm() {
  ACTIVE_BID_LINE_ITEM_ID = null;
  if (bidLineItemId) bidLineItemId.value = "";
  if (bidLineItemName) bidLineItemName.value = "";
  if (bidLineItemKind) bidLineItemKind.value = "base";
  if (bidLineItemDescription) bidLineItemDescription.value = "";
  if (bidLineItemQuantity) bidLineItemQuantity.value = "1";
  if (bidLineItemUnit) bidLineItemUnit.value = "job";
  if (bidLineItemUnitPrice) bidLineItemUnitPrice.value = "0.00";
  setInlineMessage(bidLineItemMsg, "");
}
function populateBidLineItemForm(item) {
  ACTIVE_BID_LINE_ITEM_ID = item?.id || null;
  if (bidLineItemId) bidLineItemId.value = item?.id || "";
  if (bidLineItemName) bidLineItemName.value = item?.name || "";
  if (bidLineItemKind) bidLineItemKind.value = String(item?.kind || "base");
  if (bidLineItemDescription) bidLineItemDescription.value = item?.description || "";
  if (bidLineItemQuantity) bidLineItemQuantity.value = String(item?.quantity ?? 1);
  if (bidLineItemUnit) bidLineItemUnit.value = item?.unit || "job";
  if (bidLineItemUnitPrice) bidLineItemUnitPrice.value = money(item?.unit_price_cents || 0);
}
function clearBidPhotoForm() {
  hydrateBidPhotoCategoryOptions(currentBid()?.profile || bidProfile?.value || preferredBidProfile(), bidPhotoCategory?.value || "");
  if (bidPhotoFile) bidPhotoFile.value = "";
  if (bidPhotoName) bidPhotoName.value = "";
  if (bidPhotoCategory && !bidPhotoCategory.value) bidPhotoCategory.value = "overview";
  if (bidPhotoNote) bidPhotoNote.value = "";
  setInlineMessage(bidPhotoMsg, "");
}
function collectBidFormDraft() {
  const active = currentBid();
  const profileKey = normalizeBidProfile(bidProfile?.value || active?.profile || preferredBidProfile());
  const activeMetadata = active?.metadata && typeof active.metadata === "object" ? active.metadata : {};

  const draft = {
    ...(active || emptyBidDraft(profileKey)),
    id: bidId?.value || active?.id || createLocalId("bid"),
    record_id: active?.record_id || "",
    lead_id: active?.lead_id || activeMetadata.lead_id || "",
    title: bidTitle?.value?.trim() || "",
    customer_id: bidCustomerId?.value || active?.customer_id || activeMetadata.customer_id || "",
    customer_location_id: active?.customer_location_id || activeMetadata.customer_location_id || "",
    profile: profileKey,
    status: String(bidStatus?.value || "draft"),
    template_type: bidTemplateType?.value || active?.template_type || "",
    prepared_by_user_id: bidPreparedByUser?.value || active?.prepared_by_user_id || "",
    sender_user_id: bidSenderUser?.value || active?.sender_user_id || "",
    recipient_company: bidRecipientCompany?.value?.trim() || "",
    recipient_address: bidRecipientAddress?.value?.trim() || "",
    attention_line: bidAttentionLine?.value?.trim() || "",
    subject_line: bidSubjectLine?.value?.trim() || "",
    project_name: bidProjectName?.value?.trim() || "",
    intro_text: bidIntroText?.value?.trim() || "",
    value_proposition_text: bidValuePropositionText?.value?.trim() || "",
    proposal_notes: active?.proposal_notes || "",
    proposal_status: active?.proposal_status || "",
    proposal_document_id: active?.proposal_document_id || "",
    proposal_public_token: active?.proposal_public_token || "",
    proposal_revision_number: Number(active?.proposal_revision_number || 1),
    terms_template_id: bidTermsTemplateId?.value || active?.terms_template_id || "",
    exclusions_template_id: bidExclusionsTemplateId?.value || active?.exclusions_template_id || "",
    terms_override: bidTermsOverride?.value?.trim() || "",
    exclusions_override: bidExclusionsOverride?.value?.trim() || "",
    walkthrough_at: toIsoDateTime(bidWalkthroughAt?.value) || active?.walkthrough_at || null,
    valid_until: bidValidUntil?.value || "",
    service_address: bidServiceAddress?.value?.trim() || "",
    site_contact: bidSiteContact?.value?.trim() || "",
    schedule_window: bidScheduleWindow?.value?.trim() || "",
    project_summary: bidProjectSummary?.value?.trim() || "",
    scope_of_work: bidScopeOfWork?.value?.trim() || "",
    proposed_solution: bidProposedSolution?.value?.trim() || "",
    materials_plan: bidMaterialsPlan?.value?.trim() || "",
    unused_materials_plan: bidUnusedMaterialsPlan?.value?.trim() || "",
    exclusions: bidExclusions?.value?.trim() || "",
    warranty: bidWarranty?.value?.trim() || "",
    cover_note: bidCoverNote?.value?.trim() || "",
    internal_notes: bidInternalNotes?.value?.trim() || "",
    deposit_percent: Number(bidDepositPercent?.value || 0),
    deposit_amount_cents: toCents(bidDepositAmount?.value || 0),
    terms: bidTerms?.value?.trim() || "",
    line_items: cloneJson(active?.line_items || [], []),
    proposal_options: cloneJson(active?.proposal_options || [], []),
    photos: cloneJson(active?.photos || [], []),
    updated_at: new Date().toISOString(),
  };
  if (!draft.title) draft.title = defaultBidTitleFromDraft(draft);
  return draft;
}
function updateCurrentBidFromForm(opts = {}) {
  const active = currentBid();
  if (!active && opts.allowCreate !== true) return null;
  const nextDraft = collectBidFormDraft();
  replaceBidDraft(nextDraft);
  if (opts.showMessage) setInlineMessage(bidMsg, "Bid saved.", "ok");
  return nextDraft;
}
let bidAutosaveTimer = null;
function scheduleBidAutosave() {
  if (!currentBid()) return;
  clearTimeout(bidAutosaveTimer);
  bidAutosaveTimer = setTimeout(() => {
    const nextDraft = updateCurrentBidFromForm();
    if (nextDraft) renderBidWorkspace(nextDraft, { preserveForm: true });
    renderBidList(bidSearch?.value || "");
  }, 250);
}
async function applyBidProfileStructure(force = false) {
  const active = currentBid();
  if (!active) return null;
  const profile = bidProfileConfig(bidProfile?.value || active.profile);
  const hasCustomLineItems = Array.isArray(active.line_items) && active.line_items.length > 0;
  if (force && hasCustomLineItems && !(await showConfirmModal("Replace the current line items with the starter service structure?", "Replace items", "Keep current items"))) {
    return active;
  }
  const nextDraft = {
    ...collectBidFormDraft(),
    profile: normalizeBidProfile(bidProfile?.value || active.profile),
    scope_of_work: force || !String(active.scope_of_work || "").trim() ? (profile.scopePrompt || "") : active.scope_of_work,
    proposed_solution: force || !String(active.proposed_solution || "").trim() ? (profile.solutionPrompt || "") : active.proposed_solution,
    materials_plan: force || !String(active.materials_plan || "").trim() ? (profile.materials || "") : active.materials_plan,
    unused_materials_plan: force || !String(active.unused_materials_plan || "").trim() ? (profile.unused || "") : active.unused_materials_plan,
    exclusions: force || !String(active.exclusions || "").trim() ? (profile.exclusions || "") : active.exclusions,
    warranty: force || !String(active.warranty || "").trim() ? (profile.warranty || "") : active.warranty,
    cover_note: force || !String(active.cover_note || "").trim() ? (profile.deliveryNote || "") : active.cover_note,
    terms: force || !String(active.terms || "").trim() ? (profile.terms || "") : active.terms,
    line_items: (force || !hasCustomLineItems)
      ? (profile.lineItems || []).map((item) => ({
          id: createLocalId("line"),
          name: item.name || "",
          description: item.description || "",
          quantity: Number(item.quantity || 1),
          unit: item.unit || "job",
          unit_price_cents: Number(item.unit_price_cents || 0),
          kind: String(item.kind || "base"),
        }))
      : cloneJson(active.line_items || [], []),
    updated_at: new Date().toISOString(),
  };
  replaceBidDraft(nextDraft);
  renderBids(bidSearch?.value || "");
  setInlineMessage(bidMsg, "Service profile guidance applied.", "ok");
  return nextDraft;
}
function populateBidForm(draft) {
  renderBidCustomerOptions(draft?.customer_id || "");
  if (bidId) bidId.value = draft?.id || "";
  if (bidTitle) bidTitle.value = draft?.title || "";
  if (bidProfile) bidProfile.value = normalizeBidProfile(draft?.profile);
  if (bidTemplateType) bidTemplateType.value = draft?.template_type || "standard_operational";
  hydrateBidPhotoCategoryOptions(draft?.profile, bidPhotoCategory?.value || "");
  if (bidStatus) bidStatus.value = String(draft?.status || "draft");
  if (bidWalkthroughAt) bidWalkthroughAt.value = toDateTimeLocalValue(draft?.walkthrough_at);
  if (bidValidUntil) bidValidUntil.value = draft?.valid_until || "";
  if (bidPreparedByUser) bidPreparedByUser.value = draft?.prepared_by_user_id || "";
  if (bidSenderUser) bidSenderUser.value = draft?.sender_user_id || "";
  if (bidServiceAddress) bidServiceAddress.value = draft?.service_address || "";
  if (bidSiteContact) bidSiteContact.value = draft?.site_contact || "";
  if (bidScheduleWindow) bidScheduleWindow.value = draft?.schedule_window || "";
  if (bidProjectSummary) bidProjectSummary.value = draft?.project_summary || "";
  if (bidRecipientCompany) bidRecipientCompany.value = draft?.recipient_company || "";
  if (bidAttentionLine) bidAttentionLine.value = draft?.attention_line || "";
  if (bidRecipientAddress) bidRecipientAddress.value = draft?.recipient_address || "";
  if (bidProjectName) bidProjectName.value = draft?.project_name || "";
  if (bidSubjectLine) bidSubjectLine.value = draft?.subject_line || "";
  if (bidIntroText) bidIntroText.value = draft?.intro_text || "";
  if (bidValuePropositionText) bidValuePropositionText.value = draft?.value_proposition_text || "";
  if (bidScopeOfWork) bidScopeOfWork.value = draft?.scope_of_work || "";
  if (bidProposedSolution) bidProposedSolution.value = draft?.proposed_solution || "";
  if (bidMaterialsPlan) bidMaterialsPlan.value = draft?.materials_plan || "";
  if (bidUnusedMaterialsPlan) bidUnusedMaterialsPlan.value = draft?.unused_materials_plan || "";
  if (bidExclusions) bidExclusions.value = draft?.exclusions || "";
  if (bidWarranty) bidWarranty.value = draft?.warranty || "";
  if (bidCoverNote) bidCoverNote.value = draft?.cover_note || "";
  if (bidInternalNotes) bidInternalNotes.value = draft?.internal_notes || "";
  if (bidDepositPercent) bidDepositPercent.value = String(draft?.deposit_percent ?? 0);
  if (bidDepositAmount) bidDepositAmount.value = money(draft?.deposit_amount_cents || 0);
  if (bidTerms) bidTerms.value = draft?.terms || "";
  if (bidTermsTemplateId) bidTermsTemplateId.value = draft?.terms_template_id || "";
  if (bidExclusionsTemplateId) bidExclusionsTemplateId.value = draft?.exclusions_template_id || "";
  if (bidTermsOverride) bidTermsOverride.value = draft?.terms_override || "";
  if (bidExclusionsOverride) bidExclusionsOverride.value = draft?.exclusions_override || "";
  if (bidFormTitle) bidFormTitle.textContent = draft?.title || "Proposal builder";
}
function clearBidForm() {
  renderBidCustomerOptions("");
  if (bidId) bidId.value = "";
  if (bidTitle) bidTitle.value = "";
  if (bidProfile) bidProfile.value = preferredBidProfile();
  if (bidTemplateType) bidTemplateType.value = "standard_operational";
  hydrateBidPhotoCategoryOptions(preferredBidProfile(), bidPhotoCategory?.value || "");
  if (bidStatus) bidStatus.value = "draft";
  if (bidWalkthroughAt) bidWalkthroughAt.value = "";
  if (bidValidUntil) bidValidUntil.value = "";
  if (bidPreparedByUser) bidPreparedByUser.value = "";
  if (bidSenderUser) bidSenderUser.value = "";
  if (bidServiceAddress) bidServiceAddress.value = "";
  if (bidSiteContact) bidSiteContact.value = "";
  if (bidScheduleWindow) bidScheduleWindow.value = "";
  if (bidProjectSummary) bidProjectSummary.value = "";
  if (bidRecipientCompany) bidRecipientCompany.value = "";
  if (bidAttentionLine) bidAttentionLine.value = "";
  if (bidRecipientAddress) bidRecipientAddress.value = "";
  if (bidProjectName) bidProjectName.value = "";
  if (bidSubjectLine) bidSubjectLine.value = "";
  if (bidIntroText) bidIntroText.value = "";
  if (bidValuePropositionText) bidValuePropositionText.value = "";
  if (bidScopeOfWork) bidScopeOfWork.value = "";
  if (bidProposedSolution) bidProposedSolution.value = "";
  if (bidMaterialsPlan) bidMaterialsPlan.value = "";
  if (bidUnusedMaterialsPlan) bidUnusedMaterialsPlan.value = "";
  if (bidExclusions) bidExclusions.value = "";
  if (bidWarranty) bidWarranty.value = "";
  if (bidCoverNote) bidCoverNote.value = "";
  if (bidInternalNotes) bidInternalNotes.value = "";
  if (bidDepositPercent) bidDepositPercent.value = "0";
  if (bidDepositAmount) bidDepositAmount.value = "0.00";
  if (bidTerms) bidTerms.value = "";
  if (bidTermsTemplateId) bidTermsTemplateId.value = "";
  if (bidExclusionsTemplateId) bidExclusionsTemplateId.value = "";
  if (bidTermsOverride) bidTermsOverride.value = "";
  if (bidExclusionsOverride) bidExclusionsOverride.value = "";
  if (bidFormTitle) bidFormTitle.textContent = "Proposal builder";
  clearBidLineItemForm();
  clearBidPhotoForm();
}
function bidGuidedSteps(draft) {
  const totals = calculateBidTotals(draft || {});
  const hasPricedBaseScope = bidIncludedLineItemsForOrder(draft).some((item) => bidLineItemTotalCents(item) > 0);
  const readyStatuses = ["ready_to_send", "sent", "approved"];
  const hasCustomers = CUSTOMERS_CACHE.length > 0;
  return [
    {
      id: "client_site",
      title: "Anchor the bid to a real client and place",
      copy: "Link the customer record and add the service address so this proposal belongs to a real job, not just a note.",
      done: !!draft?.customer_id && !!String(draft?.service_address || "").trim(),
      actionLabel: !draft?.customer_id ? (hasCustomers ? "Link customer" : "Create customer") : "Add address",
      targetId: !draft?.customer_id ? (hasCustomers ? "bidCustomerId" : "btnToggleBidQuickCustomer") : "bidServiceAddress",
    },
    {
      id: "problem",
      title: "Describe the problem in plain English",
      copy: "Write what the customer needs solved, then make sure the base scope explains what is actually included.",
      done: !!String(draft?.project_summary || "").trim() && !!String(draft?.scope_of_work || "").trim(),
      actionLabel: !String(draft?.project_summary || "").trim() ? "Write summary" : "Review scope",
      targetId: !String(draft?.project_summary || "").trim() ? "bidProjectSummary" : "bidScopeOfWork",
    },
    {
      id: "pricing",
      title: "Put real money on the scope",
      copy: "A bid becomes usable when the line items carry actual pricing, not placeholders. Price the base work before polishing the proposal.",
      done: hasPricedBaseScope && totals.total > 0,
      actionLabel: "Price scope",
      targetId: "bidLineItemUnitPrice",
    },
    {
      id: "proof",
      title: "Capture field proof",
      copy: "Photos reduce memory errors, justify pricing, and give the client visible confidence in what you saw during the walkthrough.",
      done: Array.isArray(draft?.photos) && draft.photos.length > 0,
      actionLabel: "Add photo",
      targetId: "bidPhotoFile",
    },
    {
      id: "delivery",
      title: "Package it so it is ready to send",
      copy: "Finish the client note, confirm the validity window, and mark the bid ready so anyone on the team knows it can go out professionally.",
      done: !!String(draft?.cover_note || "").trim() && !!String(draft?.valid_until || "").trim() && readyStatuses.includes(String(draft?.status || "").toLowerCase()),
      actionLabel: !String(draft?.cover_note || "").trim() ? "Write delivery note" : (!String(draft?.valid_until || "").trim() ? "Set validity" : "Set ready status"),
      targetId: !String(draft?.cover_note || "").trim() ? "bidCoverNote" : (!String(draft?.valid_until || "").trim() ? "bidValidUntil" : "bidStatus"),
    },
    {
      id: "operations",
      title: "Push the bid into live work",
      copy: isServiceWorkspace(currentWorkspaceBlueprint())
        ? "Once the proposal is real, move it into booked work so the rest of the business can manage it without relying on memory."
        : "Once the proposal is real, convert it into a tracked order so the rest of the business can manage it without relying on memory.",
      done: !!draft?.converted_order_id,
      actionLabel: draft?.converted_order_id
        ? (isServiceWorkspace(currentWorkspaceBlueprint()) ? "Open booked work" : "Open order")
        : (isServiceWorkspace(currentWorkspaceBlueprint()) ? "Move into booked work" : "Create tracked order"),
      targetId: "btnConvertBidToOrder",
    },
  ];
}
function focusBidFieldForStep(step) {
  const targetId = step?.targetId;
  if (!targetId) return;
  const target = $(targetId);
  if (!target) return;
  if (targetId === "btnToggleBidQuickCustomer") {
    if (!BID_QUICK_CUSTOMER_OPEN) setBidQuickCustomerOpen(true, { keepValues: true });
    renderBidQuickCustomerCard(currentBid());
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    if (typeof target.click === "function") target.click();
    window.setTimeout(() => bidQuickCustomerName?.focus({ preventScroll: true }), 80);
    return;
  }
  target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  if (targetId === "bidPhotoFile") {
    try {
      target.click();
      return;
    } catch (_) {
      // Fall through to focus.
    }
  }
  if (typeof target.focus === "function") target.focus({ preventScroll: true });
}
function renderBidGuideFlow(draft) {
  if (!bidGuideFlow) return;
  if (!draft) {
    bidGuideFlow.innerHTML = `<div class="muted">Start a bid to see the next-best action and guided workflow.</div>`;
    return;
  }

  const steps = bidGuidedSteps(draft);
  const completed = steps.filter((step) => step.done).length;
  const percent = Math.round((completed / steps.length) * 100);
  const nextStep = steps.find((step) => !step.done) || null;

  bidGuideFlow.innerHTML = `
    <div class="bid-guide-flow">
      <div class="bid-guide-flow__top">
        <div class="bid-guide-flow__progress">
          <strong>${completed}/${steps.length}</strong>
          <span>guided steps complete</span>
          <div class="bid-progress-bar"><span style="width:${percent}%;"></span></div>
        </div>
        <div class="bid-guide-flow__copy">
          This bid follows a teach-through flow so an operator does not need to be naturally organized to build a strong proposal.
          ${nextStep ? `<br><br><strong>Next best action:</strong> ${escapeHtml(nextStep.title)}.` : `<br><br><strong>Ready:</strong> this proposal has the core pieces in place and can move into delivery.`}
        </div>
        ${nextStep ? `<button class="btn btn-primary" type="button" data-bid-guide-next="${escapeAttr(nextStep.id)}">${escapeHtml(nextStep.actionLabel)}</button>` : `<span class="pill pill-on">Client-ready structure</span>`}
      </div>
      <div class="bid-step-list">
        ${steps.map((step, index) => `
          <div class="bid-step ${step.done ? "is-done" : ""}">
            <div class="bid-step__left">
              <div class="bid-step__num">${step.done ? "OK" : index + 1}</div>
              <div>
                <div class="bid-step__title">${escapeHtml(step.title)}</div>
                <div class="bid-step__copy">${escapeHtml(step.copy)}</div>
              </div>
            </div>
            <div class="bid-step__meta">
              <span class="pill ${step.done ? "pill-on" : ""}">${step.done ? "Done" : "Pending"}</span>
              <button class="btn btn-ghost btn-sm" type="button" data-bid-guide-step="${escapeAttr(step.id)}">${escapeHtml(step.done ? "Review" : step.actionLabel)}</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  bidGuideFlow.querySelectorAll("[data-bid-guide-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = steps.find((entry) => entry.id === btn.getAttribute("data-bid-guide-step"));
      if (step) focusBidFieldForStep(step);
    });
  });
  bidGuideFlow.querySelectorAll("[data-bid-guide-next]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = steps.find((entry) => entry.id === btn.getAttribute("data-bid-guide-next"));
      if (step) focusBidFieldForStep(step);
    });
  });
}
function renderBidProfileGuideCard(draft) {
  if (!bidProfileGuide) return;
  if (!draft) {
    bidProfileGuide.innerHTML = `<div class="muted">Choose a service profile to load walkthrough prompts.</div>`;
    return;
  }
  const profile = bidProfileConfig(draft.profile);
  const proposalTips = bidProposalPrompts(draft.profile);
  bidProfileGuide.innerHTML = `
    <div class="bid-stack">
      <div>
        <div class="kicker">${escapeHtml(profile.label)}</div>
        <div class="detail-copy">${escapeHtml(profile.intro)}</div>
      </div>
      <div>
        <strong>What to capture</strong>
        <ul class="bid-guide-list">
          ${profile.photoPrompts.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>
      <div>
        <strong>How to price it</strong>
        <ul class="bid-guide-list">
          ${profile.pricingPrompts.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>
      <div>
        <strong>How to make it feel professional</strong>
        <ul class="bid-guide-list">
          ${proposalTips.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>
    </div>
  `;
}
function applyBidPhotoPreset(categoryValue) {
  const profileKey = normalizeBidProfile(bidProfile?.value || currentBid()?.profile || preferredBidProfile());
  const category = bidPhotoCategoryByValue(profileKey, categoryValue);
  if (!category) return;
  hydrateBidPhotoCategoryOptions(profileKey, category.value);
  if (bidPhotoName && bidPhotoPresetNeedsName(bidPhotoName.value)) bidPhotoName.value = category.name || category.label || "";
  if (bidPhotoNote && !String(bidPhotoNote.value || "").trim()) bidPhotoNote.value = category.note || "";
  setInlineMessage(bidPhotoMsg, `${category.label} preset loaded. Capture the photo and save it to the bid.`, "");
  if (bidPhotoFile) bidPhotoFile.focus();
}
function renderBidPhotoGuide(draft) {
  if (!bidPhotoGuide) return;
  const profileKey = normalizeBidProfile(draft?.profile || bidProfile?.value || preferredBidProfile());
  const profile = bidProfileConfig(profileKey);
  const categories = bidPhotoCategories(profileKey);
  if (!categories.length) {
    bidPhotoGuide.innerHTML = `<div class="muted">No photo prompts are configured for this service profile yet.</div>`;
    return;
  }
  bidPhotoGuide.innerHTML = `
    <div class="bid-template-panel__top">
      <div>
        <strong>${escapeHtml(profile.label)} shot list</strong>
        <div class="bid-template-panel__copy">Tap a photo prompt to load the category, a suggested name, and the note starter before you capture the image.</div>
      </div>
    </div>
    <div class="bid-chip-row">
      ${categories.map((item) => `
        <button class="btn btn-ghost btn-sm" type="button" data-bid-photo-preset="${escapeAttr(item.value)}">${escapeHtml(item.label)}</button>
      `).join("")}
    </div>
  `;
  bidPhotoGuide.querySelectorAll("[data-bid-photo-preset]").forEach((btn) => {
    btn.addEventListener("click", () => applyBidPhotoPreset(btn.getAttribute("data-bid-photo-preset")));
  });
}
function addBidScopeStarter(starterKey) {
  let active = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!active) active = startNewBid(preferredBidProfile());
  const starter = bidScopeStarterLibrary(active.profile).find((item) => item.key === starterKey);
  if (!starter) return null;
  const existing = (active.line_items || []).find((item) => item.template_key === starter.key);
  if (existing) {
    populateBidLineItemForm(existing);
    setInlineMessage(bidLineItemMsg, `${starter.name} is already on this bid. Edit pricing or wording below.`, "ok");
    bidLineItemUnitPrice?.focus();
    return existing;
  }
  const nextItem = mergeBidLineItem({}, {
    ...starter,
    template_key: starter.key,
  });
  const nextDraft = {
    ...active,
    line_items: [...(active.line_items || []), nextItem],
    updated_at: new Date().toISOString(),
  };
  replaceBidDraft(nextDraft);
  renderBidWorkspace(nextDraft, { preserveForm: true });
  renderBidList(bidSearch?.value || "");
  populateBidLineItemForm(nextItem);
  setInlineMessage(bidLineItemMsg, `${starter.name} added. Price it and tighten the wording below.`, "ok");
  bidLineItemUnitPrice?.focus();
  return nextItem;
}
function renderBidScopeStarters(draft) {
  if (!bidScopeStarters) return;
  const profileKey = normalizeBidProfile(draft?.profile || bidProfile?.value || preferredBidProfile());
  const profile = bidProfileConfig(profileKey);
  const starters = bidScopeStarterLibrary(profileKey);
  if (!starters.length) {
    bidScopeStarters.innerHTML = `<div class="muted">No scope starters are configured for this service profile yet.</div>`;
    return;
  }
  const activeKeys = new Set((draft?.line_items || []).map((item) => item.template_key).filter(Boolean));
  bidScopeStarters.innerHTML = `
    <div class="bid-template-panel__top">
      <div>
        <strong>${escapeHtml(profile.label)} scope starters</strong>
        <div class="bid-template-panel__copy">Tap a starter to drop a professional line item into the bid instead of building every wash scope from scratch.</div>
      </div>
    </div>
    <div class="bid-template-grid">
      ${starters.map((item) => `
        <button class="bid-template-card ${activeKeys.has(item.key) ? "is-added" : ""}" type="button" data-bid-scope-starter="${escapeAttr(item.key)}">
          <div class="bid-template-card__kicker">${escapeHtml(formatBidLineItemKind(item.kind))}</div>
          <div class="bid-template-card__title">${escapeHtml(item.name)}</div>
          <div class="bid-template-card__copy">${escapeHtml(item.description || "")}</div>
          <div class="bid-template-card__meta">
            <span class="pill">${escapeHtml(String(item.quantity || 1))} ${escapeHtml(item.unit || "job")}</span>
            <span class="pill ${activeKeys.has(item.key) ? "pill-on" : ""}">${activeKeys.has(item.key) ? "Added" : "Add starter"}</span>
          </div>
        </button>
      `).join("")}
    </div>
  `;
  bidScopeStarters.querySelectorAll("[data-bid-scope-starter]").forEach((btn) => {
    btn.addEventListener("click", () => addBidScopeStarter(btn.getAttribute("data-bid-scope-starter")));
  });
}
function addBidCatalogStarter(productId) {
  let active = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!active) active = startNewBid(preferredBidProfile());
  const product = PRODUCTS_CACHE.find((row) => row.id === productId);
  const pricingRow = currentPricingRow(productId);
  if (!product) return null;

  const existing = (active.line_items || []).find((item) => item.product_id === productId);
  if (existing) {
    populateBidLineItemForm(existing);
    setInlineMessage(bidLineItemMsg, `${product.name} is already on this bid. Adjust the company-standard price if this job needs a custom number.`, "ok");
    bidLineItemUnitPrice?.focus();
    return existing;
  }

  const mode = normalizePricingModeForUi(pricingRow || product);
  const nextItem = mergeBidLineItem({}, {
    name: product.name || "Service line item",
    description: product.description || "",
    quantity: 1,
    unit: pricingRow?.unit_label || "job",
    unit_price_cents: mode === "quote" ? 0 : pricingAmountForUi(pricingRow || product),
    kind: "base",
    template_key: `catalog:${productId}`,
    product_id: productId,
    pricing_source: "company_standard",
  });

  const nextDraft = {
    ...active,
    line_items: [...(active.line_items || []), nextItem],
    updated_at: new Date().toISOString(),
  };
  replaceBidDraft(nextDraft);
  renderBidWorkspace(nextDraft, { preserveForm: true });
  renderBidList(bidSearch?.value || "");
  populateBidLineItemForm(nextItem);
  setInlineMessage(bidLineItemMsg, `${product.name} loaded from company-standard pricing. Adjust the number if this specific job needs a custom price.`, "ok");
  bidLineItemUnitPrice?.focus();
  return nextItem;
}
function renderBidCatalogStarters(draft) {
  if (!bidCatalogStarters) return;
  const activeServices = PRODUCTS_CACHE
    .filter((row) => !!row.is_active && !!row.is_available)
    .map((row) => ({
      product: row,
      pricing: currentPricingRow(row.id),
    }))
    .filter(({ product, pricing }) => !!product && (!!pricing || ["fixed", "starts_at", "quote"].includes(String(product.pricing_mode || "").toLowerCase())))
    .slice(0, 16);

  if (!activeServices.length) {
    bidCatalogStarters.innerHTML = `<div class="muted">Company-standard services will appear here once the service catalog has live offerings.</div>`;
    return;
  }

  const activeProductIds = new Set((draft?.line_items || []).map((item) => item.product_id).filter(Boolean));
  bidCatalogStarters.innerHTML = `
    <div class="bid-template-panel__top">
      <div>
        <strong>Company-standard pricing</strong>
        <div class="bid-template-panel__copy">Tap a live service to drop your standard pricing into this bid, then tighten it for the specific job without rebuilding the line item from scratch.</div>
      </div>
    </div>
    <div class="bid-template-grid">
      ${activeServices.map(({ product, pricing }) => `
        <button class="bid-template-card ${activeProductIds.has(product.id) ? "is-added" : ""}" type="button" data-bid-catalog-starter="${escapeAttr(product.id)}">
          <div class="bid-template-card__kicker">${escapeHtml(product.category || "Service")}</div>
          <div class="bid-template-card__title">${escapeHtml(product.name || "Service")}</div>
          <div class="bid-template-card__copy">${escapeHtml(pricingSummaryForRow(pricing || product))}</div>
          <div class="bid-template-card__meta">
            <span class="pill">${escapeHtml((pricing?.unit_label || "job").toString())}</span>
            <span class="pill ${activeProductIds.has(product.id) ? "pill-on" : ""}">${activeProductIds.has(product.id) ? "Added" : "Use standard"}</span>
          </div>
        </button>
      `).join("")}
    </div>
  `;
  bidCatalogStarters.querySelectorAll("[data-bid-catalog-starter]").forEach((btn) => {
    btn.addEventListener("click", () => addBidCatalogStarter(btn.getAttribute("data-bid-catalog-starter")));
  });
}
function renderBidStatsCard(draft) {
  if (!bidStatsWrap) return;
  if (!draft) {
    bidStatsWrap.innerHTML = `<div class="muted">No walkthrough bid selected yet.</div>`;
    return;
  }
  const totals = calculateBidTotals(draft);
  bidStatsWrap.innerHTML = `
    <div class="bid-status-grid">
      <div class="bid-stat">
        <div class="bid-stat__label">Base investment</div>
        <div class="bid-stat__value">${formatUsd(totals.total)}</div>
      </div>
      <div class="bid-stat">
        <div class="bid-stat__label">Optional upsells</div>
        <div class="bid-stat__value">${formatUsd(totals.options)}</div>
      </div>
      <div class="bid-stat">
        <div class="bid-stat__label">Walkthrough photos</div>
        <div class="bid-stat__value">${String(draft.photos?.length || 0)}</div>
      </div>
      <div class="bid-stat">
        <div class="bid-stat__label">Last saved</div>
        <div class="bid-stat__value" style="font-size:14px;">${escapeHtml(formatDateTime(draft.updated_at || draft.created_at))}</div>
      </div>
      <div class="bid-stat">
        <div class="bid-stat__label">${escapeHtml(isServiceWorkspace(currentWorkspaceBlueprint()) ? "Booked work" : "Tracked order")}</div>
        <div class="bid-stat__value" style="font-size:14px;">${escapeHtml(draft.converted_order_id ? "Created" : "Not yet")}</div>
      </div>
    </div>
  `;
}
function renderBidSignalBand(draft) {
  const wrap = document.getElementById("bidSignalBand");
  if (!wrap) return;
  if (!draft) {
    wrap.innerHTML = "";
    return;
  }
  const totals = calculateBidTotals(draft);
  const linkedOrder = currentBidOrder(draft);
  const statusValue = String(draft?.status || "draft").trim().toLowerCase();
  const hasPricedScope = bidIncludedLineItemsForOrder(draft).some((item) => bidLineItemTotalCents(item) > 0);
  const hasPhotos = Array.isArray(draft?.photos) && draft.photos.length > 0;
  const hasNarrative = !!String(draft?.project_summary || "").trim() && !!String(draft?.scope_of_work || "").trim();
  const businessKey = String(bidWorkspaceBlueprint()?.business?.key || "").trim().toLowerCase();
  const signalTone = (tone = "") => {
    if (tone === "good") return "workspace-signal-band__item--good";
    if (tone === "warn") return "workspace-signal-band__item--warn";
    if (tone === "danger") return "workspace-signal-band__item--danger";
    return "";
  };
  const items = [
    {
      label: "Proposal stage",
      value: formatBidStatus(draft.status || "draft"),
      note: linkedOrder
        ? "This proposal is already tied to booked work."
        : (statusValue === "sent" ? "The quote is out and needs a follow-up rhythm." : "Finish the core pieces and send while the walkthrough is fresh."),
      tone: linkedOrder ? "good" : (statusValue === "sent" ? "warn" : ""),
    },
    {
      label: "Scope pricing",
      value: hasPricedScope ? formatUsd(totals.total) : "Needs pricing",
      note: hasPricedScope
        ? "Base scope already carries real pricing."
        : "Add at least one priced base-scope line item before delivery.",
      tone: hasPricedScope ? "good" : "warn",
    },
    {
      label: "Field proof",
      value: hasPhotos ? `${draft.photos.length} photo${draft.photos.length === 1 ? "" : "s"}` : "Needs proof",
      note: hasPhotos
        ? "Walkthrough proof is attached to the proposal."
        : "Capture site proof so the quote feels grounded and professional.",
      tone: hasPhotos ? "good" : "warn",
    },
    {
      label: businessKey === "hydrovac" ? "Ops handoff" : "Next move",
      value: linkedOrder ? "Booked work ready" : (hasNarrative ? "Finish and send" : "Tighten scope"),
      note: businessKey === "hydrovac"
        ? (linkedOrder
          ? "Truck, disposal, and billing can now stay tied to the work record."
          : "Keep locate, access, disposal, and site assumptions visible before conversion.")
        : (linkedOrder
          ? "Operations can now carry the work the rest of the way."
          : "Keep the proposal easy to say yes to and easy to move into booked work."),
      tone: linkedOrder ? "good" : (hasNarrative ? "warn" : "danger"),
    },
  ];
  wrap.innerHTML = items.map((item) => `
    <div class="workspace-signal-band__item ${signalTone(item.tone)}">
      <span>${escapeHtml(item.label || "Signal")}</span>
      <strong>${escapeHtml(item.value || "")}</strong>
      <small>${escapeHtml(item.note || "")}</small>
    </div>
  `).join("");
}
function bidWorkspaceBlueprint() {
  if (typeof currentWorkspaceBlueprint === "function") return currentWorkspaceBlueprint();
  return { business: { key: "other", label: "Business", recordFocus: [] } };
}
function bidCustomerMemoryItems(draft, blueprint = bidWorkspaceBlueprint()) {
  if (!draft?.customer_id) return [];
  const customer = findBidCustomer(draft.customer_id);
  if (!customer) return [];
  const sharedChecklist = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL?.customerMemoryChecklist;
  if (typeof sharedChecklist === "function") {
    return sharedChecklist(customer, blueprint).slice(0, 4);
  }
  return (blueprint?.business?.recordFocus || []).slice(0, 4).map((item) => ({
    label: item.label,
    note: item.description || "",
    ready: false,
  }));
}
function renderBidCustomerMemoryCard(draft, blueprint = bidWorkspaceBlueprint()) {
  const items = bidCustomerMemoryItems(draft, blueprint);
  if (!draft?.customer_id || !items.length) return "";
  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">Customer memory</div>
      <div><strong>Keep the trade details attached to the proposal</strong></div>
      <div class="detail-copy">Use this proposal view to keep the property, access, equipment, or repair context visible while you tighten scope, pricing, and client-facing wording.</div>
      <div class="memory-checklist">
        ${items.map((item) => `
          <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""}">
            <div class="memory-checklist__label">${escapeHtml(item.label || "Detail")}</div>
            <div class="memory-checklist__note">${escapeHtml(item.note || "Still needs attention before this proposal is final.")}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}
function bidFollowThroughItems(draft, blueprint = bidWorkspaceBlueprint()) {
  const customer = draft?.customer_id ? findBidCustomer(draft.customer_id) : null;
  const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
  const statusValue = String(draft?.status || "draft").trim().toLowerCase();
  const hasPricedScope = bidIncludedLineItemsForOrder(draft).some((item) => bidLineItemTotalCents(item) > 0);
  const hasNarrative = !!String(draft?.project_summary || "").trim() && !!String(draft?.scope_of_work || "").trim();
  const hasPhotos = Array.isArray(draft?.photos) && draft.photos.length > 0;
  const detail = (label, ready, readyNote, missingNote, tone = "") => ({
    label,
    ready: !!ready,
    note: ready ? readyNote : missingNote,
    tone: tone || (!ready ? "warn" : ""),
  });
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";

  const sentOrBetter = ["sent", "approved"].includes(statusValue);
  const approvedOrConverted = statusValue === "approved" || !!draft?.converted_order_id;
  const items = [
    detail(
      "Client decision path",
      approvedOrConverted,
      draft?.converted_order_id
        ? "This proposal is already tied to booked work, so operations can carry it the rest of the way."
        : "The customer has approved the proposal and it is ready to move into booked work.",
      sentOrBetter
        ? `The proposal is out with the customer${draft?.valid_until ? ` and valid through ${formatDateOnly(draft.valid_until)}` : ""}. Follow up before it cools off.`
        : "Finish the delivery note and get this proposal in front of the customer while the walkthrough is still fresh."
    ),
    detail(
      "Scope and pricing confidence",
      hasNarrative && hasPricedScope,
      "The proposal explains the problem and already carries real pricing on the included scope.",
      "Tighten the problem summary, scope, and priced base work so the customer can say yes without guessing what is included."
    ),
    detail(
      "Proof and professionalism",
      hasPhotos && !!String(draft?.cover_note || "").trim(),
      "Field proof and delivery notes are in place, which makes the proposal easier to trust and easier to send.",
      "Add walkthrough proof and a plain-language delivery note so the proposal feels grounded and professional."
    ),
  ];

  const tradeItemMap = {
    landscaping: detail(
      "Property handoff",
      !!firstFilled(customer?.access_notes, customer?.seasonal_notes, customer?.service_notes),
      firstFilled(customer?.access_notes, customer?.seasonal_notes, customer?.service_notes),
      "Capture gate, seasonal, or property-focus notes before this proposal becomes booked work."
    ),
    cleaning: detail(
      "Visit expectations",
      !!firstFilled(customer?.checklist_notes, customer?.access_notes, customer?.add_on_notes),
      firstFilled(customer?.checklist_notes, customer?.access_notes, customer?.add_on_notes),
      "Capture access, add-ons, and checklist expectations before the quote turns into repeat work."
    ),
    hydrovac: detail(
      "Dispatch and compliance handoff",
      !!firstFilled(customer?.locate_notes, customer?.permit_notes, customer?.disposal_notes, customer?.site_access_notes, draft?.internal_notes),
      firstFilled(customer?.locate_notes, customer?.permit_notes, customer?.disposal_notes, customer?.site_access_notes, draft?.internal_notes),
      "Leave the locate, permit, truck-access, or disposal note inside the proposal before it moves into booked work."
    ),
    hvac: detail(
      "System follow-through",
      !!firstFilled(customer?.diagnostic_notes, customer?.parts_follow_up, customer?.maintenance_notes),
      firstFilled(customer?.parts_follow_up, customer?.diagnostic_notes, customer?.maintenance_notes),
      "Capture system findings, parts follow-up, or maintenance notes before the field handoff."
    ),
    plumbing: detail(
      "Repair follow-through",
      !!firstFilled(customer?.issue_summary, customer?.approval_notes, customer?.restoration_notes),
      firstFilled(customer?.issue_summary, customer?.approval_notes, customer?.restoration_notes),
      "Capture repair urgency, approval, or restoration follow-through before the proposal becomes booked work."
    ),
  };
  items.push(
    tradeItemMap[businessKey] || detail(
      "Customer handoff",
      !!firstFilled(customer?.follow_up_notes, customer?.service_notes),
      firstFilled(customer?.follow_up_notes, customer?.service_notes),
      "Capture the next customer-facing detail before this proposal moves into operations."
    )
  );
  return items;
}
function renderBidFollowThroughCard(draft, blueprint = bidWorkspaceBlueprint()) {
  if (!draft) return "";
  const items = bidFollowThroughItems(draft, blueprint);
  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">Proposal follow-through</div>
      <div><strong>Keep the decision path obvious</strong></div>
      <div class="detail-copy">Use this checklist to see what still needs tightening before the proposal is easy to send, easy to approve, and easy to move into booked work.</div>
      <div class="memory-checklist">
        ${items.map((item) => `
          <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""} ${item.tone === "warn" ? "memory-checklist__item--warn" : ""}">
            <div class="memory-checklist__label">${escapeHtml(item.label || "Detail")}</div>
            <div class="memory-checklist__note">${escapeHtml(item.note || "This part still needs attention before the proposal is ready.")}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}
function renderBidDeliveryCard(draft) {
  if (!bidDeliveryWrap) return;
  if (!draft) {
    bidDeliveryWrap.innerHTML = `<div class="muted">The proposal checklist will appear here once a draft is active.</div>`;
    return;
  }
  const blueprint = bidWorkspaceBlueprint();
  const items = [];
  if (!draft.customer_id) items.push(CUSTOMERS_CACHE.length ? "Link the bid to a customer record." : "Create the first customer record and link this bid to it.");
  if (!String(draft.service_address || "").trim()) items.push("Add the service address.");
  if (!String(draft.project_summary || "").trim()) items.push("Write the problem summary in plain English.");
  if (!bidIncludedLineItemsForOrder(draft).some((item) => bidLineItemTotalCents(item) > 0)) items.push("Add at least one priced base-scope line item.");
  if (!Array.isArray(draft.photos) || !draft.photos.length) items.push("Capture walkthrough photos from the site.");
  if (!String(draft.cover_note || "").trim()) items.push("Write the client delivery note.");
  if (!String(draft.valid_until || "").trim()) items.push("Set the proposal validity window.");
  if (!draft.converted_order_id) items.push("Convert the bid into tracked work when it is ready to move into operations.");
  const readinessMarkup = items.length
    ? `<ul class="bid-readiness-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<div class="note-item"><strong>Ready to deliver</strong><div class="muted">This draft has the essentials for a professional client proposal.</div></div>`;
  bidDeliveryWrap.innerHTML = `${readinessMarkup}${renderBidFollowThroughCard(draft, blueprint)}${renderBidCustomerMemoryCard(draft, blueprint)}`;
}
function renderBidList(filter = "") {
  if (!bidsList) return;
  const rows = sortedBids(filter);
  if (!rows.length) {
  bidsList.innerHTML = `<div class="muted">${BIDS_CACHE.length ? "No proposal drafts match this search." : "No proposal drafts yet. Click New quote to start the first one."}</div>`;
    if (!BIDS_CACHE.length) ACTIVE_BID_ID = null;
    return;
  }
  if (!rows.find((row) => row.id === ACTIVE_BID_ID)) ACTIVE_BID_ID = rows[0].id;
  bidsList.innerHTML = rows.map((row) => {
    const customer = findBidCustomer(row.customer_id);
    const totals = calculateBidTotals(row);
    return `
      <button
        type="button"
        class="list-item ${row.id === ACTIVE_BID_ID ? "is-active" : ""}"
        data-bid-id="${escapeAttr(row.id)}"
        data-bid-record-id="${escapeAttr(bidRecordId(row) || "")}">
        <div class="li-main">
          <div class="li-title">${escapeHtml(row.title || defaultBidTitleFromDraft(row))}</div>
          <div class="li-sub muted">${escapeHtml(customer?.name || "Unlinked customer")} &middot; ${escapeHtml(bidProfileConfig(row.profile).label)}</div>
          <div class="li-sub muted">${escapeHtml(row.service_address || "No service address")} &middot; ${escapeHtml(formatDateTime(row.updated_at || row.created_at))}</div>
        </div>
        <div class="li-meta">
          <span class="pill">${escapeHtml(formatBidStatus(row.status))}</span>
          ${row.converted_order_id ? `<span class="pill pill-on">${escapeHtml(isServiceWorkspace(currentWorkspaceBlueprint()) ? "Booked work" : "Tracked order")}</span>` : ""}
          <span class="pill">${formatUsd(totals.total)}</span>
        </div>
      </button>
    `;
  }).join("");
  bidsList.querySelectorAll("[data-bid-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ACTIVE_BID_ID = btn.getAttribute("data-bid-id");
      renderBids(bidSearch?.value || "");
    });
  });
}
function renderBidPhotos(draft) {
  if (!bidPhotosList) return;
  const photos = Array.isArray(draft?.photos) ? draft.photos : [];
  if (!photos.length) {
    bidPhotosList.innerHTML = `<div class="muted">No walkthrough photos saved yet.</div>`;
    return;
  }
  bidPhotosList.innerHTML = photos.map((photo) => `
    <div class="photo-card">
      <img src="${escapeAttr(photo.url || "")}" alt="${escapeAttr(photo.name || "Walkthrough photo")}" />
      <div class="photo-card__body">
        <div class="row" style="justify-content:space-between;">
          <div class="photo-card__title">${escapeHtml(photo.name || "Walkthrough photo")}</div>
          <span class="pill">${escapeHtml(bidPhotoCategoryByValue(draft?.profile, photo.category)?.label || photo.category || "overview")}</span>
        </div>
        <div class="photo-card__copy">${escapeParagraphs(photo.note || "")}</div>
        <div class="photo-card__copy">Saved ${escapeHtml(formatDateTime(photo.captured_at || draft.updated_at || draft.created_at))}</div>
        <div class="photo-card__actions">
          <button class="btn btn-ghost btn-sm" type="button" data-remove-photo-id="${escapeAttr(photo.id)}">Remove</button>
        </div>
      </div>
    </div>
  `).join("");
  bidPhotosList.querySelectorAll("[data-remove-photo-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const active = currentBid();
      if (!active) return;
      const photoId = btn.getAttribute("data-remove-photo-id");
      const nextDraft = {
        ...active,
        photos: (active.photos || []).filter((photo) => photo.id !== photoId),
        updated_at: new Date().toISOString(),
      };
      replaceBidDraft(nextDraft);
      renderBidWorkspace(nextDraft, { preserveForm: true });
      renderBidList(bidSearch?.value || "");
      setInlineMessage(bidPhotoMsg, "Photo removed from the bid.", "ok");
    });
  });
}
function renderBidLineItems(draft) {
  if (!bidLineItemsList) return;
  const rows = Array.isArray(draft?.line_items) ? draft.line_items : [];
  if (!rows.length) {
    bidLineItemsList.innerHTML = `<div class="muted">No line items added yet.</div>`;
    return;
  }
  bidLineItemsList.innerHTML = rows.map((item) => `
    <div class="line-item-card">
      <div class="line-item-card__top">
        <div>
          <div class="line-item-card__title">${escapeHtml(item.name || "Line item")}</div>
          <div class="line-item-card__copy">${escapeParagraphs(item.description || "")}</div>
        </div>
        <div class="inline">
          <span class="pill pill-on">${escapeHtml(formatBidLineItemKind(item.kind))}</span>
          <span class="pill ${item.pricing_source === "company_standard" ? "pill-on" : "pill-muted"}">${item.pricing_source === "company_standard" ? "Company standard" : "Job specific"}</span>
        </div>
      </div>
      <div class="line-item-card__meta">
        <span class="pill">${escapeHtml(String(item.quantity || 0))} ${escapeHtml(item.unit || "unit")}</span>
        <span class="pill">${formatUsd(Number(item.unit_price_cents || 0))} each</span>
        <span class="pill pill-on">${formatUsd(bidLineItemTotalCents(item))}</span>
      </div>
      <div class="line-item-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-edit-line-id="${escapeAttr(item.id)}">Edit</button>
        <button class="btn btn-ghost btn-sm" type="button" data-remove-line-id="${escapeAttr(item.id)}">Remove</button>
      </div>
    </div>
  `).join("");
  bidLineItemsList.querySelectorAll("[data-edit-line-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const active = currentBid();
      const item = active?.line_items?.find((row) => row.id === btn.getAttribute("data-edit-line-id"));
      if (item) populateBidLineItemForm(item);
    });
  });
  bidLineItemsList.querySelectorAll("[data-remove-line-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const active = currentBid();
      if (!active) return;
      const lineId = btn.getAttribute("data-remove-line-id");
      const nextDraft = {
        ...active,
        line_items: (active.line_items || []).filter((item) => item.id !== lineId),
        updated_at: new Date().toISOString(),
      };
      replaceBidDraft(nextDraft);
      clearBidLineItemForm();
      renderBidWorkspace(nextDraft, { preserveForm: true });
      renderBidList(bidSearch?.value || "");
      setInlineMessage(bidLineItemMsg, "Line item removed.", "ok");
    });
  });
}
function fillProposalSelect(selectEl, rows, currentValue, placeholder) {
  if (!selectEl) return;
  const current = String(currentValue || "").trim();
  const normalizedRows = Array.isArray(rows) ? rows : [];
  selectEl.innerHTML = [
    `<option value="">${escapeHtml(placeholder || "Select")}</option>`,
    ...normalizedRows.map((row) => {
      const value = String(row.value || row.id || "").trim();
      const label = String(row.label || row.name || value || "Option").trim();
      const detail = String(row.detail || "").trim();
      return `<option value="${escapeAttr(value)}"${value === current ? " selected" : ""}>${escapeHtml(detail ? `${label} - ${detail}` : label)}</option>`;
    }),
  ].join("");
}
function bidProposalEngine() {
  return window.ProofLinkProposalDocuments || null;
}
function stringifyProposalOptionScope(scopeNodes, depth = 0) {
  if (!Array.isArray(scopeNodes) || !scopeNodes.length) return "";
  return scopeNodes.map((node) => {
    const text = String(node?.text || "").trim();
    const children = stringifyProposalOptionScope(node?.children || [], depth + 1);
    return `${"  ".repeat(depth)}- ${text}${children ? `\n${children}` : ""}`;
  }).join("\n");
}
function parseProposalFeeRows(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label = "", amount = "", ...descriptionParts] = line.split("|").map((part) => part.trim());
      return {
        label,
        amount_cents: toCents(amount || 0),
        description: descriptionParts.join(" | "),
      };
    })
    .filter((row) => row.label || row.amount_cents || row.description);
}
function stringifyProposalFeeRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return "";
  return rows.map((row) => {
    const label = String(row?.label || "").trim();
    const amount = money(Number(row?.amount_cents || 0));
    const description = String(row?.description || "").trim();
    return [label, amount, description].filter(Boolean).join(" | ");
  }).join("\n");
}
function collectBidProposalOptionDraft() {
  const engine = bidProposalEngine();
  const scopeText = bidProposalOptionScope?.value?.trim() || "";
  return {
    id: bidProposalOptionId?.value || createLocalId("proposal_option"),
    option_type: bidProposalOptionType?.value || "option",
    option_title: bidProposalOptionTitle?.value?.trim() || "",
    pricing_label: bidProposalOptionPriceLabel?.value?.trim() || "Investment",
    price_amount_cents: toCents(bidProposalOptionPrice?.value || 0),
    price_unit: bidProposalOptionPriceUnit?.value?.trim() || "",
    fee_rows: parseProposalFeeRows(bidProposalOptionFees?.value || ""),
    scope_content: typeof engine?.parseBulletText === "function" ? engine.parseBulletText(scopeText) : scopeText,
    notes: bidProposalOptionNotes?.value?.trim() || "",
  };
}
function currentBidProposalViewModel(draft) {
  const proposalApi = proposalDocumentsApi();
  if (!draft || !proposalApi?.buildViewModelForBid) return null;
  try {
    return proposalApi.buildViewModelForBid(draft);
  } catch (_) {
    return null;
  }
}
function clearBidProposalOptionForm() {
  if (bidProposalOptionId) bidProposalOptionId.value = "";
  if (bidProposalOptionTitle) bidProposalOptionTitle.value = "";
  if (bidProposalOptionType) bidProposalOptionType.value = "option";
  if (bidProposalOptionPriceLabel) bidProposalOptionPriceLabel.value = "Investment";
  if (bidProposalOptionPrice) bidProposalOptionPrice.value = "0.00";
  if (bidProposalOptionPriceUnit) bidProposalOptionPriceUnit.value = "";
  if (bidProposalOptionFees) bidProposalOptionFees.value = "";
  if (bidProposalOptionScope) bidProposalOptionScope.value = "";
  if (bidProposalOptionNotes) bidProposalOptionNotes.value = "";
  setInlineMessage(bidProposalOptionMsg, "");
}
function populateBidProposalOptionForm(option) {
  if (!option) return clearBidProposalOptionForm();
  if (bidProposalOptionId) bidProposalOptionId.value = option.id || "";
  if (bidProposalOptionTitle) bidProposalOptionTitle.value = option.option_title || option.optionTitle || "";
  if (bidProposalOptionType) bidProposalOptionType.value = option.option_type || option.optionType || "option";
  if (bidProposalOptionPriceLabel) bidProposalOptionPriceLabel.value = option.pricing_label || option.pricingLabel || "Investment";
  if (bidProposalOptionPrice) bidProposalOptionPrice.value = money(option.price_amount_cents || option.priceAmountCents || 0);
  if (bidProposalOptionPriceUnit) bidProposalOptionPriceUnit.value = option.price_unit || option.priceUnit || "";
  if (bidProposalOptionFees) bidProposalOptionFees.value = stringifyProposalFeeRows(option.fee_rows || option.feeRows || []);
  if (bidProposalOptionScope) bidProposalOptionScope.value = Array.isArray(option.scope_content)
    ? stringifyProposalOptionScope(option.scope_content)
    : (option.scope_content || option.scopeContent || "");
  if (bidProposalOptionNotes) bidProposalOptionNotes.value = option.notes || "";
}
function renderBidProposalOptions(draft) {
  if (!bidProposalOptionsList) return;
  const options = Array.isArray(draft?.proposal_options) ? draft.proposal_options : [];
  if (!options.length) {
    bidProposalOptionsList.innerHTML = `<div class="muted">No customer-facing proposal options yet. Add at least one option so the preview follows the final document structure.</div>`;
    return;
  }
  bidProposalOptionsList.innerHTML = options.map((option) => `
    <div class="line-item-card">
      <div class="line-item-card__top">
        <div>
          <div class="line-item-card__title">${escapeHtml(option.option_title || option.optionTitle || "Option")}</div>
          <div class="line-item-card__copy">${escapeHtml(option.pricing_label || option.pricingLabel || "Investment")} ${escapeHtml(option.price_unit || option.priceUnit || "")}</div>
        </div>
        <div class="line-item-card__meta">
          <span class="pill">${escapeHtml(titleCaseWords(String(option.option_type || option.optionType || "option").replace(/_/g, " ")))}</span>
          <span class="pill pill-on">${formatUsd(Number(option.price_amount_cents || option.priceAmountCents || 0))}</span>
          ${(option.fee_rows || option.feeRows || []).length ? `<span class="pill">${escapeHtml(String((option.fee_rows || option.feeRows || []).length))} fee rows</span>` : ""}
        </div>
      </div>
      <div class="line-item-card__copy">${escapeParagraphs((option.scope_content || []).length ? (option.scope_content || []).map((node) => node.text || "").join("\n") : (option.scope_content || option.scopeContent || option.notes || ""))}</div>
      <div class="line-item-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-edit-proposal-option="${escapeAttr(option.id)}">Edit</button>
        <button class="btn btn-ghost btn-sm" type="button" data-remove-proposal-option="${escapeAttr(option.id)}">Remove</button>
      </div>
    </div>
  `).join("");
  bidProposalOptionsList.querySelectorAll("[data-edit-proposal-option]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const active = currentBid();
      const option = active?.proposal_options?.find((row) => row.id === btn.getAttribute("data-edit-proposal-option"));
      populateBidProposalOptionForm(option);
    });
  });
  bidProposalOptionsList.querySelectorAll("[data-remove-proposal-option]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const active = currentBid();
      if (!active) return;
      const optionId = btn.getAttribute("data-remove-proposal-option");
      const nextDraft = {
        ...active,
        proposal_options: (active.proposal_options || []).filter((row) => row.id !== optionId),
        updated_at: new Date().toISOString(),
      };
      replaceBidDraft(nextDraft);
      clearBidProposalOptionForm();
      renderBidWorkspace(nextDraft, { preserveForm: true });
      renderBidList(bidSearch?.value || "");
      setInlineMessage(bidProposalOptionMsg, "Proposal option removed.", "ok");
    });
  });
}
function renderBidProposalDocumentControls(draft) {
  const proposalApi = proposalDocumentsApi();
  if (!proposalApi) return;
  proposalApi.loadSupport().then(() => {
    const activeDraft = draft || currentBid() || null;
    const mergedDraft = activeDraft
      ? proposalApi.mergeDraftDefaults(activeDraft)
      : emptyBidDraft(preferredBidProfile());
    fillProposalSelect(bidTemplateType, proposalApi.templateChoices(), mergedDraft.template_type, "Choose a template");
    fillProposalSelect(bidPreparedByUser, proposalApi.senderChoices(), mergedDraft.prepared_by_user_id, "Prepared by");
    fillProposalSelect(bidSenderUser, proposalApi.senderChoices(), mergedDraft.sender_user_id, "Send as");
    fillProposalSelect(bidTermsTemplateId, proposalApi.termsChoices(mergedDraft.profile), mergedDraft.terms_template_id, "Use default terms");
    fillProposalSelect(bidExclusionsTemplateId, proposalApi.exclusionsChoices(mergedDraft.profile), mergedDraft.exclusions_template_id, "Use default exclusions");
    renderBidProposalOptions(activeDraft ? mergedDraft : { proposal_options: [] });
    if (bidBrandSetupStatus) {
      const statusCard = bidBrandSetupStatus.closest(".detail-card");
      const status = proposalApi.brandSetupStatus() || {};
      const rows = [
        { key: "companyName", label: "Company name", ready: !!status.companyName },
        { key: "logo", label: "Logo", ready: !!status.logo },
        { key: "defaultTerms", label: "Default terms", ready: !!status.defaultTerms },
        { key: "defaultExclusions", label: "Default exclusions", ready: !!status.defaultExclusions },
        { key: "defaultSigner", label: "Default signer", ready: !!status.defaultSigner },
        { key: "defaultSignerSignature", label: "Signer signature image", ready: !!status.defaultSignerSignature },
      ];
      const missingRows = rows.filter((row) => !row.ready);
      if (statusCard) statusCard.hidden = missingRows.length === 0;
      if (!missingRows.length) {
        bidBrandSetupStatus.innerHTML = "";
      } else {
        bidBrandSetupStatus.innerHTML = `
          <div class="muted" style="margin-bottom:10px;">Open the exact setting you still need. Each item disappears here as soon as it is configured.</div>
          ${missingRows.map((row) => `
            <button
              type="button"
              class="btn btn-ghost"
              data-proposal-settings-focus="${escapeAttr(row.key)}"
              style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;margin:0 0 8px;text-align:left;"
            >
              <span>${escapeHtml(row.label)}</span>
              <span class="pill pill-muted">Needs setup</span>
            </button>
          `).join("")}
        `;
        bidBrandSetupStatus.querySelectorAll("[data-proposal-settings-focus]").forEach((button) => {
          button.addEventListener("click", () => {
            const focusKey = button.getAttribute("data-proposal-settings-focus") || "";
            const openProposalSettings = window.PROOFLINK_OPERATOR_PROPOSAL_SETTINGS_WORKSPACE?.openProposalSettingsPanel;
            if (typeof openProposalSettings === "function") {
              Promise.resolve(openProposalSettings(focusKey)).catch(console.error);
              return;
            }
            if (typeof setSidebarMoreOpen === "function") setSidebarMoreOpen(true);
            if (typeof switchTab === "function") Promise.resolve(switchTab("proposal-settings")).catch(console.error);
          });
        });
      }
    }
    if (activeDraft) renderBidProposalPreview(mergedDraft);
  }).catch((err) => {
    if (bidBrandSetupStatus) {
      const statusCard = bidBrandSetupStatus.closest(".detail-card");
      if (statusCard) statusCard.hidden = false;
      bidBrandSetupStatus.textContent = err.message || "Proposal defaults could not be loaded.";
    }
  });
}
function renderBidWorkspace(draft, opts = {}) {
  renderProposalWorkspace();
  if (!BID_WORKSPACE_BOOTSTRAPPING) setBidWorkspaceBootstrapping(false);
  if (!draft) {
    clearBidForm();
    if (btnConvertBidToOrder) {
      btnConvertBidToOrder.textContent = isServiceWorkspace(currentWorkspaceBlueprint()) ? "Move into booked work" : "Create tracked order";
      btnConvertBidToOrder.disabled = true;
    }
    renderBidQuickCustomerCard(null);
    renderBidGuideFlow(null);
    renderBidProfileGuideCard(null);
    renderBidPhotoGuide(null);
    renderBidScopeStarters(null);
    renderBidCatalogStarters(null);
    renderBidSignalBand(null);
    renderBidStatsCard(null);
    renderBidDeliveryCard(null);
    renderBidProposalReadinessCard(null);
    renderBidEstimateReviewCard(null);
    renderBidQuoteRescueCard();
    if (bidPhotosList) bidPhotosList.innerHTML = `<div class="muted">No walkthrough photos saved yet.</div>`;
    if (bidLineItemsList) bidLineItemsList.innerHTML = `<div class="muted">No line items added yet.</div>`;
    clearBidProposalOptionForm();
    renderBidProposalDocumentControls(null);
    renderBidProposalPreview(null);
    return;
  }
  if (!opts.preserveForm) populateBidForm(draft);
  if (btnConvertBidToOrder) {
    const linkedOrder = currentBidOrder(draft);
    btnConvertBidToOrder.disabled = false;
    btnConvertBidToOrder.textContent = linkedOrder
      ? (isServiceWorkspace(currentWorkspaceBlueprint()) ? "Open booked work" : "Open tracked order")
      : (isServiceWorkspace(currentWorkspaceBlueprint()) ? "Move into booked work" : "Create tracked order");
  }
  renderBidQuickCustomerCard(draft);
  renderBidGuideFlow(draft);
  renderBidProfileGuideCard(draft);
  renderBidPhotoGuide(draft);
  renderBidScopeStarters(draft);
  renderBidCatalogStarters(draft);
  renderBidSignalBand(draft);
  renderBidStatsCard(draft);
  renderBidDeliveryCard(draft);
  renderBidProposalReadinessCard(draft);
  renderBidEstimateReviewCard(draft);
  renderBidQuoteRescueCard();
  renderBidPhotos(draft);
  renderBidLineItems(draft);
  renderBidProposalDocumentControls(draft);
  renderBidProposalPreview(draft);
}
function renderBids(filter = "", opts = {}) {
  const active = currentBid();
  renderBidList(filter);
  renderBidWorkspace(active, opts);
}
function startNewBid(profileKey = preferredBidProfile()) {
  const draft = emptyBidDraft(profileKey);
  BIDS_CACHE = [draft, ...(BIDS_CACHE || [])];
  ACTIVE_BID_ID = draft.id;
  persistBidDrafts();
  clearBidLineItemForm();
  clearBidPhotoForm();
  clearBidProposalOptionForm();
  renderBids(bidSearch?.value || "");
  setInlineMessage(bidMsg, "New walkthrough bid ready.", "ok");
  return draft;
}
function duplicateCurrentBid() {
  const active = currentBid();
  if (!active) return startNewBid(preferredBidProfile());
  const copy = {
    ...cloneJson(active, {}),
    id: createLocalId("bid"),
    record_id: "",
    title: `${active.title || defaultBidTitleFromDraft(active)} copy`,
    status: "draft",
    proposal_document_id: "",
    proposal_public_token: "",
    proposal_status: "draft",
    proposal_revision_number: 1,
    line_items: (active.line_items || []).map((item) => ({ ...item, id: createLocalId("line") })),
    proposal_options: (active.proposal_options || []).map((option) => ({ ...cloneJson(option, {}), id: createLocalId("proposal_option") })),
    photos: (active.photos || []).map((photo) => ({ ...photo, id: createLocalId("photo") })),
    converted_order_id: "",
    converted_at: null,
    sent_at: null,
    approved_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  replaceBidDraft(copy);
  clearBidLineItemForm();
  clearBidPhotoForm();
  clearBidProposalOptionForm();
  renderBids(bidSearch?.value || "");
  setInlineMessage(bidMsg, "Bid duplicated into a fresh draft.", "ok");
  return copy;
}
function bidBrandContext() {
  return {
    accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#c84b2f",
    tenantName: brandTenant?.textContent?.trim() || "ProofLink",
    logoUrl: brandLogo?.getAttribute("src") || "",
    tagline: SETUP_STATE?.config?.tagline || "Professional service proposal",
    contactEmail: SETUP_STATE?.config?.public_contact_email || "",
    phone: SETUP_STATE?.config?.public_business_phone || "",
  };
}
function renderProposalLineItemRows(items) {
  if (!items.length) return `<div class="muted">No items yet.</div>`;
  return items.map((item) => `
    <div class="proposal-line-item">
      <div>
        <div class="proposal-line-item__title">${escapeHtml(item.name || "Line item")}</div>
        <div class="proposal-line-item__copy">${escapeParagraphs(item.description || "")}</div>
      </div>
      <div class="proposal-line-item__right">
        <div>${escapeHtml(String(item.quantity || 0))} ${escapeHtml(item.unit || "unit")}</div>
        <div class="proposal-line-item__copy">${escapeHtml(formatBidLineItemKind(item.kind))}</div>
      </div>
      <div class="proposal-line-item__right">
        <div>${formatUsd(Number(item.unit_price_cents || 0))}</div>
        <div class="proposal-line-item__copy">${formatUsd(bidLineItemTotalCents(item))}</div>
      </div>
    </div>
  `).join("");
}
function buildBidProposalMarkup(draft) {
  if (!draft) return `<div class="muted">Create a walkthrough bid or select one from the list to preview the proposal.</div>`;
  const proposalEngine = bidProposalEngine();
  const proposalModel = currentBidProposalViewModel(draft);
  if (proposalEngine?.renderDocumentBody && proposalModel) {
    return `<div class="pl-doc-page">${proposalEngine.renderDocumentBody(proposalModel)}</div>`;
  }
  const brand = bidBrandContext();
  const customer = findBidCustomer(draft.customer_id);
  const profile = bidProfileConfig(draft.profile);
  const totals = calculateBidTotals(draft);
  const depositNote = totals.deposit > 0 ? `${formatUsd(totals.deposit)} deposit requested to schedule.` : "No deposit requested on this proposal.";
  const baseItems = (draft.line_items || []).filter((item) => String(item.kind || "base").toLowerCase() !== "option");
  const optionItems = (draft.line_items || []).filter((item) => String(item.kind || "").toLowerCase() === "option");

  return `
    <div class="proposal-shell">
      <div class="proposal-hero">
        <div>
          <div class="proposal-brand">
            <div class="proposal-brand__logo">${brand.logoUrl ? `<img src="${escapeAttr(brand.logoUrl)}" alt="${escapeAttr(brand.tenantName)} logo" />` : ""}</div>
            <div>
              <div class="proposal-kicker">${escapeHtml(profile.label)} proposal</div>
              <div class="proposal-title">${escapeHtml(draft.title || defaultBidTitleFromDraft(draft))}</div>
              <div class="proposal-copy">${escapeHtml(brand.tagline)}</div>
            </div>
          </div>
          <div class="proposal-copy">${escapeParagraphs(draft.cover_note || profile.deliveryNote || "")}</div>
        </div>
        <div class="bid-stack">
          <div class="proposal-box">
            <div class="proposal-box__label">Prepared for</div>
            <div class="proposal-box__value">${escapeHtml(customer?.name || draft.site_contact || "Client to be confirmed")}</div>
            <div class="proposal-copy">${escapeHtml(customer?.email || "")}${customer?.email && customer?.phone ? "<br>" : ""}${escapeHtml(customer?.phone || "")}</div>
          </div>
          <div class="proposal-box">
            <div class="proposal-box__label">Service address</div>
            <div class="proposal-box__value">${escapeHtml(draft.service_address || "To be confirmed")}</div>
          </div>
          <div class="proposal-box">
            <div class="proposal-box__label">Investment</div>
            <div class="proposal-box__value"><strong>${formatUsd(totals.total)}</strong></div>
            <div class="proposal-copy">${escapeHtml(depositNote)}${draft.valid_until ? `<br>Valid through ${escapeHtml(formatDateOnly(draft.valid_until))}.` : ""}</div>
          </div>
        </div>
      </div>

      <div class="proposal-grid three">
        <div class="proposal-box">
          <div class="proposal-box__label">Problem to solve</div>
          <div class="proposal-box__value">${escapeParagraphs(draft.project_summary || "")}</div>
        </div>
        <div class="proposal-box">
          <div class="proposal-box__label">Walkthrough date</div>
          <div class="proposal-box__value">${escapeHtml(draft.walkthrough_at ? formatDateTime(draft.walkthrough_at) : "Not recorded")}</div>
        </div>
        <div class="proposal-box">
          <div class="proposal-box__label">Schedule window</div>
          <div class="proposal-box__value">${escapeHtml(draft.schedule_window || "To be scheduled with client")}</div>
        </div>
      </div>

      <div class="proposal-grid">
        <div class="proposal-section proposal-box">
          <div class="proposal-box__label">Scope of work</div>
          <div class="proposal-box__value">${escapeParagraphs(draft.scope_of_work || "")}</div>
        </div>
        <div class="proposal-section proposal-box">
          <div class="proposal-box__label">Recommended solution</div>
          <div class="proposal-box__value">${escapeParagraphs(draft.proposed_solution || "")}</div>
        </div>
      </div>

      <div class="proposal-section proposal-box">
        <div class="proposal-box__label">Base scope and investment</div>
        ${renderProposalLineItemRows(baseItems)}
        <div class="proposal-total-row">
          <span>Total base investment</span>
          <strong>${formatUsd(totals.total)}</strong>
        </div>
      </div>

      ${optionItems.length ? `
        <div class="proposal-section proposal-box">
          <div class="proposal-box__label">Optional add-ons</div>
          ${renderProposalLineItemRows(optionItems)}
          <div class="proposal-total-row">
            <span>Optional work if approved</span>
            <strong>${formatUsd(totals.options)}</strong>
          </div>
        </div>
      ` : ""}

      ${(draft.photos || []).length ? `
        <div class="proposal-section">
          <h3>Walkthrough photo record</h3>
          <div class="proposal-photo-grid">
            ${(draft.photos || []).map((photo) => `
              <div class="proposal-photo">
                <img src="${escapeAttr(photo.url || "")}" alt="${escapeAttr(photo.name || "Walkthrough photo")}" />
                <div class="proposal-photo__body">
                  <div class="proposal-photo__title">${escapeHtml(photo.name || "Walkthrough photo")}</div>
                  <div class="proposal-photo__meta"><span class="pill">${escapeHtml(bidPhotoCategoryByValue(draft?.profile, photo.category)?.label || photo.category || "Overview")}</span></div>
                  <div class="proposal-photo__copy">${escapeParagraphs(photo.note || "")}</div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <div class="proposal-grid">
        <div class="proposal-box">
          <div class="proposal-box__label">Materials plan</div>
          <div class="proposal-box__value">${escapeParagraphs(draft.materials_plan || "")}</div>
        </div>
        <div class="proposal-box">
          <div class="proposal-box__label">Unused / overage handling</div>
          <div class="proposal-box__value">${escapeParagraphs(draft.unused_materials_plan || "")}</div>
        </div>
        <div class="proposal-box">
          <div class="proposal-box__label">Exclusions / assumptions</div>
          <div class="proposal-box__value">${escapeParagraphs(draft.exclusions || "")}</div>
        </div>
        <div class="proposal-box">
          <div class="proposal-box__label">Warranty</div>
          <div class="proposal-box__value">${escapeParagraphs(draft.warranty || "")}</div>
        </div>
      </div>

      <div class="proposal-grid">
        <div class="proposal-box">
          <div class="proposal-box__label">Commercial terms</div>
          <div class="proposal-box__value">${escapeParagraphs(draft.terms || "")}</div>
        </div>
        <div class="proposal-box">
          <div class="proposal-box__label">Next step</div>
          <div class="proposal-box__value">${escapeHtml(depositNote)}</div>
          <div class="proposal-copy">Reply with approval, or send back revisions before ${escapeHtml(draft.valid_until ? formatDateOnly(draft.valid_until) : "the stated validity date")}.</div>
          ${brand.contactEmail || brand.phone ? `<div class="proposal-copy">${escapeHtml(brand.contactEmail || "")}${brand.contactEmail && brand.phone ? "<br>" : ""}${escapeHtml(brand.phone || "")}</div>` : ""}
        </div>
      </div>
    </div>
  `;
}
function renderBidProposalPreview(draft) {
  if (!bidProposalPreview) return;
  if (!draft) {
    bidProposalPreview.innerHTML = `<div class="muted">Create a walkthrough bid or select one from the list to preview the proposal.</div>`;
    return;
  }
  const frame = document.createElement("iframe");
  frame.title = "Proposal preview";
  frame.setAttribute("loading", "lazy");
  frame.style.width = "100%";
  frame.style.minHeight = "980px";
  frame.style.height = "980px";
  frame.style.border = "0";
  frame.style.background = "#f3f3ef";
  frame.style.borderRadius = "16px";
  frame.srcdoc = bidDocumentHtml(draft);
  frame.addEventListener("load", () => {
    try {
      const win = frame.contentWindow;
      const nextHeight = Math.max(
        win?.document?.body?.scrollHeight || 0,
        win?.document?.documentElement?.scrollHeight || 0,
        980,
      );
      frame.style.height = `${nextHeight + 12}px`;
    } catch (_) {
      // Keep the default preview height when the document cannot be measured.
    }
  });
  bidProposalPreview.innerHTML = "";
  bidProposalPreview.appendChild(frame);
}
function bidDocumentHtml(draft) {
  const proposalEngine = bidProposalEngine();
  const proposalModel = currentBidProposalViewModel(draft);
  if (proposalEngine?.renderDocumentPage && proposalModel) {
    return proposalEngine.renderDocumentPage(proposalModel, {
      title: draft?.project_name || draft?.title || "ProofLink proposal",
    });
  }
  const accent = bidBrandContext().accent;
  const body = buildBidProposalMarkup(draft);
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(draft?.title || "ProofLink proposal")}</title>
      <style>
        body{margin:0;padding:32px;font-family:Arial,sans-serif;background:#faf8f5;color:#151515;}
        .proposal-shell{display:flex;flex-direction:column;gap:18px;}
        .proposal-hero{display:grid;grid-template-columns:1.2fr .8fr;gap:16px;padding-bottom:18px;border-bottom:1px solid #ddd;}
        .proposal-brand{display:flex;align-items:flex-start;gap:14px;}
        .proposal-brand__logo{width:56px;height:56px;border-radius:18px;overflow:hidden;border:1px solid #ddd;background:#fff;}
        .proposal-brand__logo img{width:100%;height:100%;object-fit:cover;}
        .proposal-kicker{color:${accent};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;}
        .proposal-title{font-size:30px;line-height:1.05;font-weight:800;margin-top:6px;}
        .proposal-copy{color:#555;line-height:1.65;margin-top:8px;}
        .proposal-box{border:1px solid #ddd;border-radius:18px;padding:14px;background:#fff;}
        .proposal-box__label{color:#666;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;}
        .proposal-box__value{font-size:15px;line-height:1.55;}
        .proposal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;}
        .proposal-grid.three{grid-template-columns:repeat(3,minmax(0,1fr));}
        .proposal-line-item{display:grid;grid-template-columns:1.5fr .7fr .7fr;gap:12px;align-items:start;padding:12px 0;border-top:1px solid #ddd;}
        .proposal-line-item:first-child{border-top:none;padding-top:0;}
        .proposal-line-item__title{font-weight:700;}
        .proposal-line-item__copy{color:#555;font-size:12px;line-height:1.5;margin-top:6px;}
        .proposal-line-item__right{text-align:right;}
        .proposal-total-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:12px;margin-top:12px;border-top:1px solid #ddd;}
        .proposal-total-row strong{font-size:18px;}
        .proposal-photo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;}
        .proposal-photo{border:1px solid #ddd;border-radius:18px;overflow:hidden;background:#fff;}
        .proposal-photo img{width:100%;height:160px;object-fit:cover;display:block;}
        .proposal-photo__body{padding:12px;}
        .proposal-photo__title{font-weight:700;}
        .proposal-photo__meta{margin-top:8px;}
        .proposal-photo__copy{color:#555;font-size:12px;line-height:1.5;margin-top:6px;}
        .proposal-section h3{margin:0 0 10px;font-size:14px;}
        .pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid #ddd;border-radius:999px;font-size:11px;font-weight:700;background:#fff;}
        @media print{body{padding:18px;}}
      </style>
    </head>
    <body>${body}</body>
  </html>`;
}
async function copyTextValue(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    return true;
  }
}
function buildBidClientEmail(draft) {
  const customer = findBidCustomer(draft?.customer_id);
  const profile = bidProfileConfig(draft?.profile);
  const totals = calculateBidTotals(draft);
  const baseItems = (draft?.line_items || []).filter((item) => String(item.kind || "base").toLowerCase() !== "option");
  const bulletLines = baseItems.slice(0, 4).map((item) => `- ${item.name}: ${item.description || `${item.quantity} ${item.unit}`}`.trim());
  return [
    `Hi ${customer?.name || "there"},`,
    ``,
    `Thanks again for walking the project with us at ${draft?.service_address || "the site"}.`,
    ``,
    `${draft?.cover_note || profile.deliveryNote || "Attached is the proposal we prepared from the walkthrough."}`,
    ``,
    `Included in this proposal:`,
    ...(bulletLines.length ? bulletLines : ["- Scope and pricing are attached in the proposal document."]),
    ``,
    `Base investment: ${formatUsd(totals.total)}`,
    totals.options > 0 ? `Optional add-ons available: ${formatUsd(totals.options)}` : null,
    totals.deposit > 0 ? `Requested deposit: ${formatUsd(totals.deposit)}` : null,
    draft?.valid_until ? `Proposal valid through: ${formatDateOnly(draft.valid_until)}` : null,
    ``,
    `Reply with approval, questions, or requested revisions and we will get the next step moving.`,
    ``,
    `${bidBrandContext().tenantName}`,
    bidBrandContext().contactEmail || null,
    bidBrandContext().phone || null,
  ].filter(Boolean).join("\n");
}
function currentBidOrder(draft) {
  if (!draft) return null;
  return CRM_ORDERS_CACHE.find((row) => row.id === draft.converted_order_id)
    || CRM_ORDERS_CACHE.find((row) => row.bid_id && row.bid_id === bidRecordId(draft))
    || CRM_ORDERS_CACHE.find((row) => ["walkthrough_bid", "service_bid"].includes(String(row.source_type || "").toLowerCase()) && [draft.id, bidRecordId(draft)].includes(String(row.source_ref || "")))
    || null;
}
function buildOrderNotesFromBid(draft) {
  const sections = [
    draft.project_summary ? `Problem summary:\n${draft.project_summary}` : "",
    draft.scope_of_work ? `Scope of work:\n${draft.scope_of_work}` : "",
    draft.proposed_solution ? `Recommended solution:\n${draft.proposed_solution}` : "",
    draft.materials_plan ? `Materials plan:\n${draft.materials_plan}` : "",
    draft.unused_materials_plan ? `Unused / overage handling:\n${draft.unused_materials_plan}` : "",
    draft.exclusions ? `Exclusions / assumptions:\n${draft.exclusions}` : "",
    draft.terms ? `Commercial terms:\n${draft.terms}` : "",
  ].filter(Boolean);
  const optionalItems = bidOptionalLineItems(draft);
  if (optionalItems.length) {
    sections.push(`Optional add-ons:\n${optionalItems.map((item) => `- ${item.name}: ${formatUsd(bidLineItemTotalCents(item))}`).join("\n")}`);
  }
  if (draft.photos?.length) {
    sections.push(`Walkthrough photo count: ${draft.photos.length}`);
  }
  return sections.join("\n\n");
}
async function existingOrderForBidId(bidIdValue) {
  const key = String(bidIdValue || "").trim();
  if (!key) return null;
  if (isUuidLike(key)) {
    const byBid = await scopeQuery(sb
      .from("orders")
      .select("*"))
      .eq("bid_id", key)
      .limit(1);
    if (byBid.error) throw byBid.error;
    if (Array.isArray(byBid.data) && byBid.data.length) return byBid.data[0];
  }
  const { data, error } = await scopeQuery(sb
    .from("orders")
    .select("*"))
    .eq("source_ref", key)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}
async function convertBidToTrackedOrder() {
  let baseDraft = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!baseDraft) throw new Error("Create a bid first.");
  if (!baseDraft.customer_id) throw new Error("Link the bid to a customer before converting it into tracked work.");
  const customer = findBidCustomer(baseDraft.customer_id);
  if (!customer) throw new Error("The linked customer record could not be found. Refresh customers and try again.");
  await flushBidDraftSync({ throwOnError: true });
  baseDraft = currentBid() || baseDraft;
  const recordId = bidRecordId(baseDraft);

  const existing = currentBidOrder(baseDraft) || await existingOrderForBidId(recordId || baseDraft.id);
  if (existing) {
    ACTIVE_ORDER_ID = existing.id;
    const nextDraft = {
      ...baseDraft,
      converted_order_id: existing.id,
      converted_at: baseDraft.converted_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    replaceBidDraft(nextDraft);
    await fetchCrmOrders();
    renderOrders();
    renderDashboard();
    renderGuidance();
    renderMoney().catch(console.error);
    return { order: existing, draft: nextDraft, existed: true };
  }

  const items = bidIncludedLineItemsForOrder(baseDraft).map((item) => ({
    name: item.name,
    description: item.description || "",
    quantity: Number(item.quantity || 0),
    unit: item.unit || "job",
    kind: item.kind || "base",
    unitPriceCents: Number(item.unit_price_cents || 0),
    totalCents: bidLineItemTotalCents(item),
  }));
  if (!items.length) throw new Error("Add at least one non-optional line item before converting the bid.");

  const totals = calculateBidTotals(baseDraft);
  const status = String(baseDraft.status || "").toLowerCase() === "approved" ? "confirmed" : "quoted";
  const nowIso = new Date().toISOString();
  if (recordId) {
    const { data, error } = await sb.rpc("create_order_from_bid", { p_bid_id: recordId });
    if (!error) {
      await Promise.all([fetchCrmOrders(), fetchCustomers(), fetchPayments(), fetchLeads(), fetchJobs(), loadPersistedBids()]);
      let order = CRM_ORDERS_CACHE.find((row) => row.id === data?.order_id) || await existingOrderForBidId(recordId);
      if (!order) throw new Error("The bid converted, but the tracked order could not be reloaded.");

      order = await seedOrderDepositDefaults(order, {
        depositRequiredCents: totals.deposit,
        depositPolicy: totals.deposit > 0 ? "required_before_job" : "optional",
        depositDueDate: baseDraft.valid_until || order.payment_due_date || null,
      });
      ACTIVE_ORDER_ID = order.id;
      const refreshedDraft = findBidRecordById(recordId) || currentBid() || baseDraft;
      renderOrders();
      renderCustomersList(customerSearch?.value || "");
      renderDashboard();
      renderGuidance();
      renderMoney().catch(console.error);
      return { order, draft: refreshedDraft, existed: !!data?.existing };
    }
    if (!isMissingDatabaseFeatureError(error, ["create_order_from_bid"])) throw error;
  }
  const payload = withTenantScope({
    operator_id: opId(),
    customer_id: customer.id,

    lead_id: baseDraft.lead_id || null,
    bid_id: recordId || null,
    status,
    fulfillment: "service",
    scheduled_date: null,
    scheduled_time: baseDraft.schedule_window || null,
    items,
    subtotal_cents: totals.total,
    total_cents: totals.total,
    estimated_total_cents: totals.total + totals.options,
    item_count: items.length,
    unpriced_count: items.filter((item) => !Number(item.unitPriceCents || 0)).length,
    cart_summary: baseDraft.project_summary || baseDraft.title || "",
    notes: buildOrderNotesFromBid(baseDraft),
    customer_name: customer.name || "",
    email: customer.email || null,
    phone: customer.phone || null,
    preferred_contact: customer.preferred_contact || "email",
    payment_due_date: baseDraft.valid_until || null,
    deposit_required_cents: totals.deposit,
    source_type: "walkthrough_bid",
    source_ref: recordId || baseDraft.id,
    created_at: nowIso,
    updated_at: nowIso,
  });
  const { data, error } = await sb.from("orders").insert(payload).select("*").single();
  if (error) throw error;
  const orderWithDepositDefaults = await seedOrderDepositDefaults(data, {
    depositRequiredCents: totals.deposit,
    depositPolicy: totals.deposit > 0 ? "required_before_job" : "optional",
    depositDueDate: baseDraft.valid_until || null,
  });

  await sb.from("customer_interactions").insert(withTenantScope({
    operator_id: opId(),
    customer_id: customer.id,
    type: "bid_converted",
    summary: `Converted walkthrough bid into tracked order for ${formatUsd(totals.total)}`,
    metadata: {
      bid_id: baseDraft.id,
      order_id: orderWithDepositDefaults.id,
      status,
      service_address: baseDraft.service_address || null,
    },
    created_at: nowIso,
  }));

  ACTIVE_ORDER_ID = orderWithDepositDefaults.id;
  if (recordId) {
    await Promise.allSettled([
      sb.from("bids")
        .update({
          converted_order_id: orderWithDepositDefaults.id,
          converted_at: nowIso,
          status: String(baseDraft.status || "").toLowerCase() === "approved" ? "converted" : (baseDraft.status || "draft"),
          updated_at: nowIso,
        })
        .eq("id", recordId)
        .eq(OPERATOR_COLUMN, opId())
        .eq(TENANT_COLUMN, TENANT_ID),
      baseDraft.lead_id
        ? sb.from("leads")
          .update({
            converted_order_id: orderWithDepositDefaults.id,
            status: "converted",
            last_activity_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", baseDraft.lead_id)
          .eq(OPERATOR_COLUMN, opId())
          .eq(TENANT_COLUMN, TENANT_ID)
        : Promise.resolve(),
    ]);
  }
  const nextDraft = {
    ...baseDraft,
    converted_order_id: orderWithDepositDefaults.id,
    converted_at: nowIso,
    updated_at: nowIso,
  };
  replaceBidDraft(nextDraft);
  await Promise.all([fetchCrmOrders(), fetchCustomers(), fetchPayments(), fetchLeads(), fetchJobs(), loadPersistedBids()]);
  renderOrders();
  renderCustomersList(customerSearch?.value || "");
  renderDashboard();
  renderGuidance();
  renderMoney().catch(console.error);
  return { order: orderWithDepositDefaults, draft: nextDraft, existed: false };
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}
async function uploadBidPhotoAsset(file, bidDraft) {
  const key = `walkthrough-bids/${TENANT_ID}/${opId()}/${bidDraft.id}/${Date.now()}_${safeFilename(file.name || "photo.jpg")}`;
  try {
    const { error } = await sb.storage.from("product-images").upload(key, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "image/jpeg",
    });
    if (error) throw error;
    const { data } = sb.storage.from("product-images").getPublicUrl(key);
    if (!data?.publicUrl) throw new Error("Photo uploaded but no public URL returned.");
    return { url: data.publicUrl, storage_mode: "cloud" };
  } catch (err) {
    return {
      url: await fileToDataUrl(file),
      storage_mode: "local",
      warning: err.message || String(err),
    };
  }
}
let BID_WORKSPACE_BINDINGS_BOUND = false;
function initBidWorkspaceBindings() {
  if (BID_WORKSPACE_BINDINGS_BOUND) return;
  BID_WORKSPACE_BINDINGS_BOUND = true;

bidSearch?.addEventListener("input", debounce(() => renderBids(bidSearch.value, { preserveForm: true })));
btnNewBid?.addEventListener("click", () => startNewBid(preferredBidProfile()));
btnDuplicateBid?.addEventListener("click", () => duplicateCurrentBid());
btnApplyBidProfile?.addEventListener("click", () => applyBidProfileStructure(false));
btnToggleBidQuickCustomer?.addEventListener("click", () => {
  setBidQuickCustomerOpen(!BID_QUICK_CUSTOMER_OPEN, { keepValues: BID_QUICK_CUSTOMER_OPEN });
  renderBidQuickCustomerCard(currentBid());
  if (BID_QUICK_CUSTOMER_OPEN) bidQuickCustomerName?.focus();
});
btnCancelBidQuickCustomer?.addEventListener("click", () => {
  setBidQuickCustomerOpen(false);
  renderBidQuickCustomerCard(currentBid());
});
btnSaveBidQuickCustomer?.addEventListener("click", async () => {
  const active = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!active) {
    setInlineMessage(bidQuickCustomerMsg, "Create a bid first so there is something to link.", "error");
    return;
  }
  const hasIdentity = [bidQuickCustomerName?.value, bidQuickCustomerEmail?.value, bidQuickCustomerPhone?.value]
    .some((value) => String(value || "").trim());
  if (!hasIdentity) {
    setInlineMessage(bidQuickCustomerMsg, "Add at least a name, email, or phone so the customer record is usable.", "error");
    bidQuickCustomerName?.focus();
    return;
  }

  setInlineMessage(bidQuickCustomerMsg, "Saving and linking customer...");
  try {
    const customer = await saveCustomerRecord({
      name: bidQuickCustomerName?.value,
      email: bidQuickCustomerEmail?.value,
      phone: bidQuickCustomerPhone?.value,
      preferred_contact: bidQuickCustomerPreferredContact?.value,
      notes: bidQuickCustomerNote?.value,
    });
    const nextDraft = attachCustomerToCurrentBid(customer) || currentBid();
    setBidQuickCustomerOpen(false);
    renderBids(bidSearch?.value || "");
    setInlineMessage(bidMsg, `${customer.name || "Customer"} saved and linked to this bid.`, "ok");
    if (nextDraft?.service_address) return;
    bidServiceAddress?.focus();
  } catch (err) {
    setInlineMessage(bidQuickCustomerMsg, err.message || String(err), "error");
  }
});
btnConvertBidToOrder?.addEventListener("click", async () => {
  const draft = currentBid();
  if (!draft) {
    setInlineMessage(bidMsg, "Create a bid first so there is something to convert.", "error");
    return;
  }
  const existing = currentBidOrder(draft);
  if (existing) {
    ACTIVE_ORDER_ID = existing.id;
    await Promise.resolve(switchTab("orders"));
    return;
  }
  setInlineMessage(bidMsg, isServiceWorkspace(currentWorkspaceBlueprint()) ? "Moving quote into booked work..." : "Creating tracked order...");
  try {
    const result = await convertBidToTrackedOrder();
    renderBids(bidSearch?.value || "", { preserveForm: true });
    setInlineMessage(
      bidMsg,
      result.existed
        ? (isServiceWorkspace(currentWorkspaceBlueprint()) ? "Booked work already existed. Opening it next." : "Tracked order already existed. Opening Orders next.")
        : (isServiceWorkspace(currentWorkspaceBlueprint()) ? "Quote moved into booked work. Opening it next." : "Tracked order created. Opening Orders next."),
      "ok",
    );
    await Promise.resolve(switchTab("orders"));
  } catch (err) {
    setInlineMessage(bidMsg, err.message || String(err), "error");
  }
});
bidForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const nextDraft = updateCurrentBidFromForm({ allowCreate: true }) || startNewBid(preferredBidProfile());
  renderBidWorkspace(nextDraft, { preserveForm: true });
  renderBidList(bidSearch?.value || "");
  setInlineMessage(bidMsg, "Bid saved locally. Syncing...", "ok");
  if (BID_SYNC_TIMER) {
    window.clearTimeout(BID_SYNC_TIMER);
    BID_SYNC_TIMER = null;
  }
  try {
    const syncedDraft = await flushBidDraftSync({
      throwOnError: true,
      proposalSync: { createVersion: true, triggerEvent: "manual_save" },
    });
      if (syncedDraft) {
        await loadPersistedBids();
        const refreshed = currentBid() || syncedDraft;
        renderBidWorkspace(refreshed, { preserveForm: true });
        renderBidList(bidSearch?.value || "");
      }
      markWorkspaceClean("bids");
      setInlineMessage(bidMsg, "Bid saved.", "ok");
    } catch (err) {
    setInlineMessage(bidMsg, err.message || String(err), "error");
  }
});
[bidTitle, bidCustomerId, bidProfile, bidStatus, bidTemplateType, bidPreparedByUser, bidSenderUser, bidWalkthroughAt, bidValidUntil, bidRecipientCompany, bidAttentionLine, bidRecipientAddress, bidProjectName, bidSubjectLine, bidIntroText, bidValuePropositionText, bidServiceAddress, bidSiteContact, bidScheduleWindow, bidProjectSummary, bidScopeOfWork, bidProposedSolution, bidMaterialsPlan, bidUnusedMaterialsPlan, bidExclusions, bidWarranty, bidCoverNote, bidInternalNotes, bidDepositPercent, bidDepositAmount, bidTerms, bidTermsTemplateId, bidExclusionsTemplateId, bidTermsOverride, bidExclusionsOverride].forEach((el) => {
  el?.addEventListener("input", scheduleBidAutosave);
  el?.addEventListener("change", () => {
    scheduleBidAutosave();
    if (el === bidProfile) {
      const draft = collectBidFormDraft();
      hydrateBidPhotoCategoryOptions(draft.profile, bidPhotoCategory?.value || "");
      renderBidProfileGuideCard(draft);
      renderBidPhotoGuide(draft);
      renderBidScopeStarters(draft);
    }
    if (el === bidCustomerId) {
      if (bidCustomerId?.value) setBidQuickCustomerOpen(false);
      renderBidQuickCustomerCard(collectBidFormDraft());
    }
  });
});
bidPhotoForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  let active = currentBid();
  if (!active) active = startNewBid(preferredBidProfile());
  const file = bidPhotoFile?.files?.[0];
  if (!file) {
    setInlineMessage(bidPhotoMsg, "Choose or capture a photo first.", "error");
    return;
  }
  const photoName = bidPhotoName?.value?.trim() || file.name || "Walkthrough photo";
  setInlineMessage(bidPhotoMsg, "Saving photo...", "");
  try {
    const upload = await uploadBidPhotoAsset(file, active);
    const baseDraft = updateCurrentBidFromForm({ allowCreate: true }) || active;
    const nextDraft = {
      ...baseDraft,
      photos: [
        {
          id: createLocalId("photo"),
          name: photoName,
          category: bidPhotoCategory?.value || "overview",
          note: bidPhotoNote?.value?.trim() || "",
          url: upload.url,
          storage_mode: upload.storage_mode,
          captured_at: new Date().toISOString(),
        },
        ...(baseDraft.photos || []),
      ],
      updated_at: new Date().toISOString(),
    };
    replaceBidDraft(nextDraft);
    clearBidPhotoForm();
    renderBidWorkspace(nextDraft, { preserveForm: true });
    renderBidList(bidSearch?.value || "");
    setInlineMessage(bidPhotoMsg, upload.warning ? `Photo saved locally in this browser. ${upload.warning}` : "Photo saved to the bid.", "ok");
  } catch (err) {
    setInlineMessage(bidPhotoMsg, err.message || String(err), "error");
  }
});
btnClearBidLineItem?.addEventListener("click", clearBidLineItemForm);
bidLineItemForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  let active = currentBid();
  if (!active) active = startNewBid(preferredBidProfile());
  const itemName = bidLineItemName?.value?.trim() || "";
  if (!itemName) {
    setInlineMessage(bidLineItemMsg, "Line item name is required.", "error");
    return;
  }
  const existingItem = (active.line_items || []).find((row) => row.id === (bidLineItemId?.value || ACTIVE_BID_LINE_ITEM_ID));
  const item = mergeBidLineItem(existingItem, {
    id: bidLineItemId?.value || createLocalId("line"),
    name: itemName,
    description: bidLineItemDescription?.value?.trim() || "",
    quantity: Number(bidLineItemQuantity?.value || 0),
    unit: bidLineItemUnit?.value?.trim() || "job",
    unit_price_cents: toCents(bidLineItemUnitPrice?.value || 0),
    kind: String(bidLineItemKind?.value || "base"),
  });
  const baseDraft = updateCurrentBidFromForm({ allowCreate: true }) || active;
  const nextDraft = {
    ...baseDraft,
    line_items: [
      ...(baseDraft.line_items || []).filter((row) => row.id !== item.id),
      item,
    ].sort((a, b) => a.name.localeCompare(b.name)),
    updated_at: new Date().toISOString(),
  };
  replaceBidDraft(nextDraft);
  clearBidLineItemForm();
  renderBidWorkspace(nextDraft, { preserveForm: true });
  renderBidList(bidSearch?.value || "");
  setInlineMessage(bidLineItemMsg, "Line item saved.", "ok");
});
btnClearBidProposalOption?.addEventListener("click", clearBidProposalOptionForm);
bidProposalOptionForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  let active = currentBid();
  if (!active) active = startNewBid(preferredBidProfile());
  const optionDraft = collectBidProposalOptionDraft();
  if (!optionDraft.option_title) {
    setInlineMessage(bidProposalOptionMsg, "Option title is required.", "error");
    return;
  }
  const baseDraft = updateCurrentBidFromForm({ allowCreate: true }) || active;
  const proposalOptions = Array.isArray(baseDraft.proposal_options) ? [...baseDraft.proposal_options] : [];
  const existingIndex = proposalOptions.findIndex((row) => row.id === optionDraft.id);
  if (existingIndex >= 0) {
    proposalOptions[existingIndex] = optionDraft;
  } else {
    proposalOptions.push(optionDraft);
  }
  const nextDraft = {
    ...baseDraft,
    proposal_options: proposalOptions,
    updated_at: new Date().toISOString(),
  };
  replaceBidDraft(nextDraft);
  clearBidProposalOptionForm();
  renderBidWorkspace(nextDraft, { preserveForm: true });
  renderBidList(bidSearch?.value || "");
  setInlineMessage(bidProposalOptionMsg, "Proposal option saved.", "ok");
});
btnPrintBidProposal?.addEventListener("click", () => {
  const active = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!active) {
    setInlineMessage(bidMsg, "Create a bid first so there is something to print.", "error");
    return;
  }
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) {
    setInlineMessage(bidMsg, "Allow popups to print the proposal.", "error");
    return;
  }
  win.document.open();
  win.document.write(bidDocumentHtml(active));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 350);
});
$("btnEmailBidToCustomer")?.addEventListener("click", async () => {
  const active = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!active) {
    setInlineMessage(bidMsg, "Create a bid first.", "error");
    return;
  }
  const customer = findBidCustomer(active.customer_id);
  if (!customer?.email) {
    setInlineMessage(bidMsg, "Add a customer with an email address before sending.", "error");
    return;
  }
  const btn = $("btnEmailBidToCustomer");
  if (btn) btn.disabled = true;
  setInlineMessage(bidMsg, "Sending...", "ok");
  try {
    const syncedDraft = await flushBidDraftSync({
      throwOnError: true,
      proposalSync: { createVersion: true, triggerEvent: "manual_save" },
    });
    const readyDraft = syncedDraft || currentBid() || active;
    const remoteBidId = bidRecordId(readyDraft);
    if (!remoteBidId) throw new Error("Save the proposal before emailing it.");
    const tok = await getAccessToken();
    const res = await fetch("/.netlify/functions/send-bid-email", {
      method : "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
      body   : JSON.stringify({
        bid_id: remoteBidId,
        proposal_document_id: readyDraft.proposal_document_id || null,
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Failed to send");
    setInlineMessage(bidMsg, `Proposal emailed to ${customer.email}.`, "ok");
    const sentAt = new Date().toISOString();
    const idx = BIDS_CACHE.findIndex((r) => r.id === active.id);
    if (idx >= 0) {
      BIDS_CACHE[idx] = {
        ...BIDS_CACHE[idx],
        status: "sent",
        proposal_status: "sent",
        sent_at: sentAt,
      };
    }
    renderBids(bidSearch?.value || "");
  } catch (err) {
    setInlineMessage(bidMsg, err.message || "Error sending.", "error");
  }
  if (btn) btn.disabled = false;
});

btnCopyBidEmail?.addEventListener("click", async () => {
  const active = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!active) {
    setInlineMessage(bidMsg, "Create a bid first so there is a message to copy.", "error");
    return;
  }
  await copyTextValue(buildBidClientEmail(active));
  setInlineMessage(bidMsg, "Client email copy is on the clipboard.", "ok");
});
btnExportBidJson?.addEventListener("click", () => {
  const active = updateCurrentBidFromForm({ allowCreate: true }) || currentBid();
  if (!active) {
    setInlineMessage(bidMsg, "Create a bid first so there is something to export.", "error");
    return;
  }
  const blob = new Blob([JSON.stringify(active, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(active.title || "walkthrough-bid") || "walkthrough-bid"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
}

const BID_WORKSPACE_HELPERS = {
  runBidProposalReadinessReview,
  renderBidProposalReadinessCard,
  renderBidProposalReadinessReport,
  runBidEstimateReview,
  renderBidEstimateReviewCard,
  runBidQuoteRescueReview,
  renderBidQuoteRescueCard,
  renderBidEstimateReviewReport,
  renderBidQuoteRescueReport,
  openBidAiRecordRef,
  persistBidDrafts,
  setBidWorkspaceBootstrapping,
  loadBidDrafts,
  loadPersistedBids,
  flushBidDraftSync,
  queueBidDraftSync,
  replaceBidDraft,
  sortedBids,
  renderBidCustomerOptions,
  clearBidQuickCustomerForm,
  setBidQuickCustomerOpen,
  renderBidQuickCustomerCard,
  attachCustomerToCurrentBid,
  clearBidLineItemForm,
  populateBidLineItemForm,
  clearBidPhotoForm,
  collectBidFormDraft,
  updateCurrentBidFromForm,
  scheduleBidAutosave,
  applyBidProfileStructure,
  populateBidForm,
  clearBidForm,
  bidGuidedSteps,
  focusBidFieldForStep,
  renderBidGuideFlow,
  renderBidProfileGuideCard,
  applyBidPhotoPreset,
  renderBidPhotoGuide,
  addBidScopeStarter,
  renderBidScopeStarters,
  addBidCatalogStarter,
  renderBidCatalogStarters,
  renderBidSignalBand,
  renderBidStatsCard,
  bidWorkspaceBlueprint,
  bidCustomerMemoryItems,
  bidFollowThroughItems,
  renderBidFollowThroughCard,
  renderBidCustomerMemoryCard,
  renderBidDeliveryCard,
  renderBidList,
  renderBidPhotos,
  renderBidLineItems,
  renderBidWorkspace,
  renderBids,
  startNewBid,
  duplicateCurrentBid,
  bidBrandContext,
  renderProposalLineItemRows,
  buildBidProposalMarkup,
  renderBidProposalPreview,
  bidDocumentHtml,
  copyTextValue,
  buildBidClientEmail,
  currentBidOrder,
  buildOrderNotesFromBid,
  existingOrderForBidId,
  convertBidToTrackedOrder,
  fileToDataUrl,
  uploadBidPhotoAsset,
  initBidWorkspaceBindings,
};

window.PROOFLINK_OPERATOR_BIDS_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_BIDS_WORKSPACE || {}),
  ...BID_WORKSPACE_HELPERS,
};

Object.assign(window, BID_WORKSPACE_HELPERS);

