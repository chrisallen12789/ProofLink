// operator.brand-init.js
// Applies brand CSS variables and page title from PROOFLINK_BRAND config.
// Must load synchronously (no defer) before operator.css to prevent FOUC.
(function () {
  var b = window.PROOFLINK_BRAND || null;
  if (!b) return;
  var root = document.documentElement;
  var r = root.style;
  var darkTokens = {
    bg0: b.bg0 || "#0b0b0b",
    bg1: b.bg1 || "#121212",
    panel: b.panel || "#161616",
    text: b.text || "#f5f2ea",
    muted: b.muted || "#b8b1a5",
    border: b.border || "rgba(255,255,255,.08)"
  };

  function applyBrandTheme(theme) {
    r.setProperty("--accent", b.accent || "#c84b2f");
    if (theme === "dark") {
      r.setProperty("--bg0", darkTokens.bg0);
      r.setProperty("--bg1", darkTokens.bg1);
      r.setProperty("--panel", darkTokens.panel);
      r.setProperty("--text", darkTokens.text);
      r.setProperty("--muted", darkTokens.muted);
      r.setProperty("--border", darkTokens.border);
      return;
    }
    r.removeProperty("--bg0");
    r.removeProperty("--bg1");
    r.removeProperty("--panel");
    r.removeProperty("--text");
    r.removeProperty("--muted");
    r.removeProperty("--border");
  }

  function resolveInitialTheme() {
    try {
      var savedTheme = localStorage.getItem("pl_theme");
      var hasExplicitThemeChoice = localStorage.getItem("pl_theme_choice_v2") === "1";
      if (hasExplicitThemeChoice && (savedTheme === "light" || savedTheme === "dark")) return savedTheme;
    } catch (error) {
      // Ignore storage restrictions and fall back to the default readable theme.
    }
    return "light";
  }

  window.applyProoflinkBrandTheme = applyBrandTheme;
  applyBrandTheme(resolveInitialTheme());
  root.setAttribute("data-brand", "1");
  var tenant  = (b.tenantName  || "Tenant").trim();
  var product = (b.productName || "ProofLink").trim();
  document.title = tenant + " - " + product + " Operator";
}());
