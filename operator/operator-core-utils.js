// Shared operator-side helpers extracted from operator.js so the main client
// can shrink without breaking the existing global utility contract.
(function attachOperatorCoreUtils(global) {
  function showToast(msg, duration = 3500, tone = "neutral") {
    const palette = {
      neutral: { bg: "#1e2029", border: "rgba(255,255,255,.15)", color: "#e8e9eb" },
      ok: { bg: "#163a22", border: "rgba(88,214,141,.35)", color: "#e9fff1" },
      error: { bg: "#4a1d1f", border: "rgba(248,113,113,.35)", color: "#fff1f2" },
    };
    const colors = palette[tone] || palette.neutral;
    const el = document.createElement("div");
    el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:${colors.bg};border:1px solid ${colors.border};border-radius:8px;padding:10px 20px;color:${colors.color};font-size:.85rem;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,.5);pointer-events:none;`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  function notifyOperator(message, tone = "error", duration = 4200) {
    if (!message) return;
    showToast(String(message), duration, tone);
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (s) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[s]));
  }

  function escapeAttr(value) {
    return escapeHtml(String(value ?? "")).replace(/"/g, "&quot;");
  }

  function normalizePick(str) {
    return String(str ?? "").trim().replace(/\s+/g, " ");
  }

  function cleanUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const next = new URL(raw);
      if (!["http:", "https:"].includes(next.protocol)) return "";
      return next.toString();
    } catch (_) {
      return "";
    }
  }

  function money(cents) {
    return (Number(cents || 0) / 100).toFixed(2);
  }

  function formatUsd(cents) {
    return `$${money(cents)}`;
  }

  function debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function toCents(numStr) {
    return Math.round(Number(numStr || 0) * 100);
  }

  function safeFilename(name) {
    return String(name || "file").trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9._-]/g, "");
  }

  function yyyymm(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function slugify(str) {
    return String(str || "").trim().toLowerCase().replace(/["']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function monthKeyFromDate(dateStr) {
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime()) ? null : yyyymm(d);
  }

  function formatDateTime(iso) {
    const d = new Date(iso || Date.now());
    return Number.isNaN(d.getTime()) ? "Unknown" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function formatDateOnly(iso) {
    const d = new Date(iso || Date.now());
    return Number.isNaN(d.getTime()) ? "Unknown" : d.toLocaleDateString([], { dateStyle: "medium" });
  }

  function prettifyDay(day) {
    const value = String(day || "").trim().toLowerCase();
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Day";
  }

  function formatTime12(value) {
    const raw = String(value || "").trim();
    if (!raw.includes(":")) return raw || "-";
    const [hStr, mStr] = raw.split(":");
    const h = Number(hStr);
    if (Number.isNaN(h)) return raw;
    const suffix = h >= 12 ? "PM" : "AM";
    const hour12 = ((h + 11) % 12) + 1;
    return `${hour12}:${String(mStr || "00").padStart(2, "0")} ${suffix}`;
  }

  function showConfirmModal(message, confirmText = "Confirm", cancelText = "Cancel") {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;";
      overlay.innerHTML = `
        <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
          <p style="margin:0 0 24px;font-size:.95rem;color:#e8e9eb;line-height:1.6;">${message}</p>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button id="confirmModalCancel" style="background:transparent;border:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.7);border-radius:5px;padding:9px 20px;font-size:.85rem;cursor:pointer;">${cancelText}</button>
            <button id="confirmModalOk" style="background:#c84b2f;color:#fff;border:none;border-radius:5px;padding:9px 20px;font-size:.85rem;font-weight:700;cursor:pointer;">${confirmText}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector("#confirmModalOk").onclick = () => { overlay.remove(); resolve(true); };
      overlay.querySelector("#confirmModalCancel").onclick = () => { overlay.remove(); resolve(false); };
    });
  }

  function showCopyModal(message, value, closeText = "Close") {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;";
      overlay.innerHTML = `
        <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:24px;max-width:520px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
          <p style="margin:0 0 12px;font-size:.95rem;color:#e8e9eb;line-height:1.5;">${escapeHtml(message)}</p>
          <textarea readonly style="width:100%;min-height:92px;background:#14161d;border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#f3f4f6;padding:12px;font-size:.85rem;resize:vertical;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;">${escapeHtml(value || "")}</textarea>
          <div style="display:flex;justify-content:flex-end;margin-top:12px;">
            <button id="copyModalClose" style="background:#c84b2f;color:#fff;border:none;border-radius:5px;padding:9px 20px;font-size:.85rem;font-weight:700;cursor:pointer;">${closeText}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const close = () => {
        overlay.remove();
        resolve();
      };
      overlay.querySelector("#copyModalClose").onclick = close;
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) close();
      });
      const area = overlay.querySelector("textarea");
      area?.focus();
      area?.select();
    });
  }

  function setInlineMessage(el, message = "", tone = "") {
    if (!el) return;
    el.textContent = message || "";
    el.className = tone ? `msg ${tone}` : "msg";
  }

  function markOrderReviewRequested(orderId, reviewRequestedAt = new Date().toISOString()) {
    if (!orderId) return reviewRequestedAt;
    if (!Array.isArray(global.CRM_ORDERS_CACHE)) return reviewRequestedAt;
    global.CRM_ORDERS_CACHE = global.CRM_ORDERS_CACHE.map((row) => (
      String(row?.id || "") === String(orderId)
        ? { ...row, review_requested_at: reviewRequestedAt }
        : row
    ));
    return reviewRequestedAt;
  }

  async function requestOrderReview(orderId, options = {}) {
    const {
      setStatus = null,
      pendingMessage = "Requesting review...",
      successMessage = "Review request sent.",
      successTone = "ok",
      button = null,
      requestedLabel = "Review requested",
      onSuccess = null,
    } = options;

    if (!orderId) throw new Error("Missing order_id");
    if (typeof setStatus === "function" && pendingMessage) {
      setStatus(pendingMessage);
    }

    const tokenProvider =
      (typeof global.getAccessToken === "function" && global.getAccessToken)
      || (typeof global.getOperatorAccessToken === "function" && global.getOperatorAccessToken)
      || (typeof global.PROOFLINK_OPERATOR_RUNTIME?.getAccessToken === "function"
        && global.PROOFLINK_OPERATOR_RUNTIME.getAccessToken.bind(global.PROOFLINK_OPERATOR_RUNTIME));
    if (typeof tokenProvider !== "function") {
      throw new Error("Operator auth is not ready yet.");
    }
    const token = await tokenProvider();
    const tenantId = String(global.TENANT_ID || "").trim();
    const response = await global.fetch("/.netlify/functions/request-review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        order_id: orderId,
        ...(tenantId && tenantId !== "default" ? { tenant_id: tenantId } : {}),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Could not request review.");
    }

    const reviewRequestedAt = payload.review_requested_at || new Date().toISOString();
    markOrderReviewRequested(orderId, reviewRequestedAt);

    if (button) {
      button.textContent = requestedLabel;
      button.disabled = true;
    }
    if (typeof onSuccess === "function") {
      await onSuccess(payload, reviewRequestedAt);
    }
    if (typeof setStatus === "function" && successMessage) {
      setStatus(successMessage, successTone);
    }

    return {
      ...payload,
      review_requested_at: reviewRequestedAt,
    };
  }

  function downloadCsv(filename, headers, rows) {
    const escape = (value) => {
      const text = String(value ?? "").replace(/"/g, '""');
      return /[,"\n\r]/.test(text) ? `"${text}"` : text;
    };
    const lines = [headers.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function getCurrentPositionSafe(options = {}) {
    if (!("geolocation" in navigator)) return null;
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = Number(position.coords?.latitude);
          const lng = Number(position.coords?.longitude);
          resolve(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null);
        },
        () => resolve(null),
        {
          enableHighAccuracy: true,
          timeout: 4000,
          maximumAge: 60000,
          ...options,
        }
      );
    });
  }

  const utils = {
    showToast,
    notifyOperator,
    escapeHtml,
    escapeAttr,
    normalizePick,
    cleanUrl,
    money,
    formatUsd,
    debounce,
    toCents,
    safeFilename,
    yyyymm,
    slugify,
    monthKeyFromDate,
    formatDateTime,
    formatDateOnly,
    prettifyDay,
    formatTime12,
    showConfirmModal,
    showCopyModal,
    setInlineMessage,
    markOrderReviewRequested,
    requestOrderReview,
    downloadCsv,
    getCurrentPositionSafe,
  };

  global.PROOFLINK_OPERATOR_UTILS = {
    ...(global.PROOFLINK_OPERATOR_UTILS || {}),
    ...utils,
  };
  Object.assign(global, utils);
})(window);
