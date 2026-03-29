// operator.brand-init.js
// Applies brand CSS variables and page title from PROOFLINK_BRAND config.
// Must load synchronously (no defer) before operator.css to prevent FOUC.
(function () {
  var b = window.PROOFLINK_BRAND || null;
  if (!b) return;
  var r = document.documentElement.style;
  r.setProperty("--accent", b.accent || "#c84b2f");
  r.setProperty("--bg0",    b.bg0    || "#0b0b0b");
  r.setProperty("--bg1",    b.bg1    || "#121212");
  r.setProperty("--panel",  b.panel  || "#161616");
  r.setProperty("--text",   b.text   || "#f5f2ea");
  r.setProperty("--muted",  b.muted  || "#b8b1a5");
  r.setProperty("--border", b.border || "rgba(255,255,255,.08)");
  document.documentElement.setAttribute("data-brand", "1");
  var tenant  = (b.tenantName  || "Tenant").trim();
  var product = (b.productName || "ProofLink").trim();
  document.title = tenant + " - " + product + " Operator";
}());
