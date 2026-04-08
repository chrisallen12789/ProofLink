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

  const _scriptLoadCache = new Map();

  function loadScriptOnce(src, options = {}) {
    const url = String(src || '').trim();
    if (!url) return Promise.reject(new Error('Missing script URL.'));
    if (_scriptLoadCache.has(url)) return _scriptLoadCache.get(url);

    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing && options.globalName ? global[options.globalName] : true) {
      const ready = Promise.resolve(existing);
      _scriptLoadCache.set(url, ready);
      return ready;
    }

    const pending = new Promise((resolve, reject) => {
      const script = existing || document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = () => resolve(script);
      script.onerror = () => {
        _scriptLoadCache.delete(url);
        reject(new Error(`Failed to load ${url}`));
      };
      if (!existing) document.head.appendChild(script);
    });
    _scriptLoadCache.set(url, pending);
    return pending;
  }

  async function ensureJsPdfLoaded() {
    if (global.jspdf?.jsPDF) return global.jspdf.jsPDF;
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js', { globalName: 'jspdf' });
    if (!global.jspdf?.jsPDF) throw new Error('The PDF tool did not finish loading.');
    return global.jspdf.jsPDF;
  }

  const OPERATOR_WORKSPACE_SCRIPT_MAP = {
    'proposal-settings': ['./operator-proposal-settings-workspace.js'],
    team: ['./operator-team-workspace.js'],
    equipment: ['./operator-equipment-workspace.js'],
    import: ['./import-workspace.js'],
    messages: ['./operator-assistant-workspace.js'],
    ai: ['./operator-assistant-workspace.js'],
    facilities: ['./operator-hydrovac-ops-workspace.js'],
    manifests: ['./operator-hydrovac-ops-workspace.js'],
    locates: ['./operator-hydrovac-ops-workspace.js'],
    compliance: ['./operator-hydrovac-ops-workspace.js'],
    bookings: ['./operator-dispatch-workspace.js'],
  };

  async function ensureOperatorWorkspaceScript(tab) {
    const key = String(tab || '').trim().toLowerCase();
    const scripts = OPERATOR_WORKSPACE_SCRIPT_MAP[key] || [];
    if (!scripts.length) return [];
    return Promise.all(scripts.map((src) => loadScriptOnce(src)));
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

  function openManualEmailPrep(options = {}) {
    return new Promise((resolve) => {
      const {
        title = "Prepare email",
        recipientName = "Customer",
        recipientEmail = "",
        contextLabel = "",
        reason = "Review this message before you send it.",
        subject = "",
        message = "",
        ctaLabel = "",
        ctaUrl = "",
        confirmText = "Send email",
        cancelText = "Cancel",
      } = options;

      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.68);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;";
      overlay.innerHTML = `
        <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:24px;max-width:720px;width:100%;box-shadow:0 12px 44px rgba(0,0,0,.52);">
          <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:18px;">
            <div>
              <div style="font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.48);margin-bottom:6px;">Manual send</div>
              <div style="font-size:1.1rem;font-weight:700;color:#f3f4f6;">${escapeHtml(title)}</div>
              <div style="font-size:.88rem;color:rgba(255,255,255,.72);margin-top:6px;">${escapeHtml(reason)}</div>
            </div>
            <button type="button" id="manualEmailClose" style="background:transparent;border:none;color:rgba(255,255,255,.7);font-size:1.1rem;cursor:pointer;">×</button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
            <label style="display:block;font-size:.82rem;color:rgba(255,255,255,.72);">
              To
              <input id="manualEmailRecipient" readonly value="${escapeAttr([recipientName, recipientEmail].filter(Boolean).join(" | "))}" style="margin-top:6px;width:100%;background:#14161d;border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#f3f4f6;padding:10px 12px;font-size:.9rem;" />
            </label>
            <label style="display:block;font-size:.82rem;color:rgba(255,255,255,.72);">
              Why now
              <input id="manualEmailContext" readonly value="${escapeAttr(contextLabel || "Customer follow-through")}" style="margin-top:6px;width:100%;background:#14161d;border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#f3f4f6;padding:10px 12px;font-size:.9rem;" />
            </label>
          </div>
          <label style="display:block;font-size:.82rem;color:rgba(255,255,255,.72);margin-bottom:12px;">
            Subject
            <input id="manualEmailSubject" value="${escapeAttr(subject)}" style="margin-top:6px;width:100%;background:#14161d;border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#f3f4f6;padding:10px 12px;font-size:.95rem;" />
          </label>
          <label style="display:block;font-size:.82rem;color:rgba(255,255,255,.72);margin-bottom:12px;">
            Message
            <textarea id="manualEmailMessage" rows="10" style="margin-top:6px;width:100%;background:#14161d;border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#f3f4f6;padding:12px;font-size:.92rem;line-height:1.55;resize:vertical;">${escapeHtml(message)}</textarea>
          </label>
          ${ctaUrl ? `
            <div style="background:#14161d;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:12px;margin-bottom:14px;">
              <div style="font-size:.78rem;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.46);margin-bottom:4px;">Call to action</div>
              <div style="font-size:.9rem;color:#f3f4f6;">${escapeHtml(ctaLabel || "Open link")}</div>
              <div style="font-size:.82rem;color:rgba(255,255,255,.66);margin-top:4px;word-break:break-word;">${escapeHtml(ctaUrl)}</div>
            </div>` : ""}
          <div id="manualEmailError" style="min-height:18px;font-size:.82rem;color:#fda4af;margin-bottom:10px;"></div>
          <div style="display:flex;justify-content:flex-end;gap:10px;">
            <button type="button" id="manualEmailCancel" style="background:transparent;border:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.76);border-radius:6px;padding:10px 18px;font-size:.85rem;cursor:pointer;">${cancelText}</button>
            <button type="button" id="manualEmailSend" style="background:#c84b2f;color:#fff;border:none;border-radius:6px;padding:10px 18px;font-size:.85rem;font-weight:700;cursor:pointer;">${confirmText}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const close = (result = { confirmed: false }) => {
        overlay.remove();
        resolve(result);
      };
      const errorEl = overlay.querySelector("#manualEmailError");
      const subjectEl = overlay.querySelector("#manualEmailSubject");
      const messageEl = overlay.querySelector("#manualEmailMessage");
      const sendButton = overlay.querySelector("#manualEmailSend");

      overlay.querySelector("#manualEmailClose").onclick = () => close({ confirmed: false });
      overlay.querySelector("#manualEmailCancel").onclick = () => close({ confirmed: false });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) close({ confirmed: false });
      });
      sendButton.onclick = () => {
        const nextSubject = normalizePick(subjectEl?.value || "");
        const nextMessage = normalizePick(messageEl?.value || "");
        if (!nextSubject) {
          if (errorEl) errorEl.textContent = "Add a subject before you send this email.";
          subjectEl?.focus();
          return;
        }
        if (!nextMessage) {
          if (errorEl) errorEl.textContent = "Add the message you want the customer to receive.";
          messageEl?.focus();
          return;
        }
        close({
          confirmed: true,
          subject: nextSubject,
          message: nextMessage,
          ctaLabel: normalizePick(ctaLabel),
          ctaUrl: cleanUrl(ctaUrl),
        });
      };

      subjectEl?.focus();
      subjectEl?.select?.();
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
      pendingMessage = "Preparing review request...",
      successMessage = "Review request sent.",
      successTone = "ok",
      button = null,
      requestedLabel = "Review requested",
      onSuccess = null,
      subject = "How did we do?",
      message = "",
      customerName = "there",
      businessName = "our team",
      openComposer = null,
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
    const reviewMessage = normalizePick(message || [
      `Hi ${customerName},`,
      "",
      `Thank you for choosing ${businessName}. If you have a moment, we would really appreciate a quick review.`,
      "Your feedback helps us improve and helps future customers know what to expect.",
      "",
      "If there is anything we should make right first, just reply to this email and let us know.",
    ].join("\n"));
    const composer = openComposer || global.PROOFLINK_OPERATOR_UTILS?.openManualEmailPrep || openManualEmailPrep;
    const prepared = await composer({
      title: "Review request",
      recipientName: customerName,
      contextLabel: "Completed work follow-through",
      reason: "Review this message before it goes out. ProofLink does not auto-send customer communication from here.",
      subject,
      message: reviewMessage,
      confirmText: "Send review request",
      cancelText: "Keep for later",
    });
    if (!prepared?.confirmed) {
      if (typeof setStatus === "function") {
        setStatus("Review request kept for later.");
      }
      return { ok: false, skipped: true, canceled: true };
    }
    const response = await global.fetch("/.netlify/functions/request-review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        order_id: orderId,
        manual_subject: prepared.subject,
        manual_message: prepared.message,
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
    loadScriptOnce,
    ensureJsPdfLoaded,
    ensureOperatorWorkspaceScript,
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
    openManualEmailPrep,
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
