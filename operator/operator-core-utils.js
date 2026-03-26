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

  function setInlineMessage(el, message = "", tone = "") {
    if (!el) return;
    el.textContent = message || "";
    el.className = tone ? `msg ${tone}` : "msg";
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
    setInlineMessage,
    getCurrentPositionSafe,
  };

  global.PROOFLINK_OPERATOR_UTILS = {
    ...(global.PROOFLINK_OPERATOR_UTILS || {}),
    ...utils,
  };
  Object.assign(global, utils);
})(window);
